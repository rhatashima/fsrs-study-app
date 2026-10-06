import {
  AppError,
  defaultAppSettings,
  isLevel,
  LEARNING_PHASES,
  REVIEW_RATINGS,
  type AppSettings,
  type Card,
  type CategoryProgress,
  type DailyProgress,
  type Level,
  type MaterialProgress,
  type RatingCounts,
  type ReviewLog,
  type ReviewState,
  type SchedulerConfig,
  type SchedulingSnapshot,
  type StepDuration,
  type StudyMaterial,
} from '../../domain'
import { toDate } from './serialization'

/*
 * Firestore から読んだデータの検証（外部データの境界）。
 * 型注釈だけを信用せず、必須項目・型・日時・列挙値を確かめてからドメイン型に変換する。
 * 不正なら AppError('invalid-data') を投げる。小さな手書きの検証で足りるため、検証ライブラリは使わない。
 */

type Data = Record<string, unknown>

const STEP_PATTERN = /^\d+(\.\d+)?[mhd]$/

class Fields {
  private readonly data: Data
  private readonly path: string

  constructor(data: Data, path: string) {
    this.data = data
    this.path = path
  }

  fail(field: string): never {
    throw new AppError('invalid-data', `保存されているデータの形式が正しくありません（${this.path} の ${field}）。`)
  }

  private value(key: string): unknown {
    return this.data[key]
  }

  has(key: string): boolean {
    return this.value(key) !== undefined
  }

  string(key: string): string {
    const v = this.value(key)
    return typeof v === 'string' ? v : this.fail(key)
  }

  optionalString(key: string): string | undefined {
    const v = this.value(key)
    if (v === undefined || v === null) return undefined
    return typeof v === 'string' ? v : this.fail(key)
  }

  nullableString(key: string): string | null {
    return this.optionalString(key) ?? null
  }

  number(key: string): number {
    const v = this.value(key)
    return typeof v === 'number' && Number.isFinite(v) ? v : this.fail(key)
  }

  nullableNumber(key: string): number | null {
    const v = this.value(key)
    if (v === null || v === undefined) return null
    return this.number(key)
  }

  integer(key: string, min = Number.MIN_SAFE_INTEGER): number {
    const v = this.number(key)
    return Number.isInteger(v) && v >= min ? v : this.fail(key)
  }

  boolean(key: string): boolean {
    const v = this.value(key)
    return typeof v === 'boolean' ? v : this.fail(key)
  }

  date(key: string): Date {
    return toDate(this.value(key)) ?? this.fail(key)
  }

  nullableDate(key: string): Date | null {
    const v = this.value(key)
    if (v === null || v === undefined) return null
    return toDate(v) ?? this.fail(key)
  }

  oneOf<T extends string>(key: string, values: readonly T[]): T {
    const v = this.value(key)
    return typeof v === 'string' && (values as readonly string[]).includes(v) ? (v as T) : this.fail(key)
  }

  optionalLevel(key: string): Level | undefined {
    const v = this.value(key)
    if (v === undefined || v === null) return undefined
    return isLevel(v) ? v : this.fail(key)
  }

  stringArray(key: string): string[] {
    const v = this.value(key)
    return Array.isArray(v) && v.every((item) => typeof item === 'string') ? [...v] : this.fail(key)
  }

  numberArray(key: string): number[] {
    const v = this.value(key)
    return Array.isArray(v) && v.every((item) => typeof item === 'number' && Number.isFinite(item))
      ? [...(v as number[])]
      : this.fail(key)
  }

  steps(key: string): StepDuration[] {
    const steps = this.stringArray(key)
    return steps.every((step) => STEP_PATTERN.test(step)) ? (steps as StepDuration[]) : this.fail(key)
  }

  map(key: string): Fields {
    const v = this.value(key)
    return isPlainObject(v) ? new Fields(v, `${this.path}.${key}`) : this.fail(key)
  }

  nullableMap(key: string): Fields | null {
    const v = this.value(key)
    if (v === null || v === undefined) return null
    return this.map(key)
  }

  entries(key: string): [string, Fields][] {
    const v = this.value(key)
    if (!isPlainObject(v)) return this.fail(key)
    return Object.entries(v).map(([entryKey, entry]) =>
      isPlainObject(entry) ? [entryKey, new Fields(entry, `${this.path}.${key}.${entryKey}`)] : this.fail(`${key}.${entryKey}`),
    )
  }

  /** 値が id と一致することを確かめる（ドキュメント id と中身の対応） */
  matches(key: string, expected: string): string {
    const v = this.string(key)
    return v === expected ? v : this.fail(key)
  }
}

function isPlainObject(value: unknown): value is Data {
  return value !== null && typeof value === 'object' && !Array.isArray(value) && toDate(value) === null
}

function fields(data: unknown, path: string): Fields {
  if (!isPlainObject(data)) throw new AppError('invalid-data', `保存されているデータの形式が正しくありません（${path}）。`)
  return new Fields(data, path)
}

function ratingCounts(f: Fields): RatingCounts {
  return { again: f.integer('again', 0), hard: f.integer('hard', 0), good: f.integer('good', 0), easy: f.integer('easy', 0) }
}

function snapshot(f: Fields): SchedulingSnapshot {
  return {
    phase: f.oneOf('phase', LEARNING_PHASES),
    due: f.date('due'),
    stability: f.number('stability'),
    difficulty: f.number('difficulty'),
    scheduledDays: f.number('scheduledDays'),
    learningSteps: f.integer('learningSteps', 0),
    reps: f.integer('reps', 0),
    lapses: f.integer('lapses', 0),
    lastReviewedAt: f.nullableDate('lastReviewedAt'),
  }
}

export function parseMaterial(id: string, data: unknown): StudyMaterial {
  const f = fields(data, `materials/${id}`)
  return {
    id: f.matches('id', id),
    title: f.string('title'),
    description: f.string('description'),
    isActive: f.boolean('isActive'),
    newCardsPerDay: f.integer('newCardsPerDay', 0),
    createdAt: f.date('createdAt'),
    updatedAt: f.date('updatedAt'),
  }
}

export function parseCard(materialId: string, id: string, data: unknown): Card {
  const f = fields(data, `materials/${materialId}/cards/${id}`)
  const card: Card = {
    id: f.matches('id', id),
    materialId: f.matches('materialId', materialId),
    question: f.string('question'),
    answer: f.string('answer'),
    explanation: f.string('explanation'),
    category: f.string('category'),
    tags: f.stringArray('tags'),
    order: f.integer('order', 1),
    isArchived: f.boolean('isArchived'),
    createdAt: f.date('createdAt'),
    updatedAt: f.date('updatedAt'),
  }
  const optional = {
    subcategory: f.optionalString('subcategory'),
    examDifficulty: f.optionalLevel('examDifficulty'),
    importance: f.optionalLevel('importance'),
    imageUrl: f.optionalString('imageUrl'),
    source: f.optionalString('source'),
    notes: f.optionalString('notes'),
  }
  for (const [key, value] of Object.entries(optional)) {
    if (value !== undefined) Object.assign(card, { [key]: value })
  }
  return card
}

export function parseReviewState(materialId: string, cardId: string, data: unknown): ReviewState {
  const f = fields(data, `materials/${materialId}/reviewStates/${cardId}`)
  return {
    ...snapshot(f),
    cardId: f.matches('cardId', cardId),
    materialId: f.matches('materialId', materialId),
    suspended: f.boolean('suspended'),
    firstReviewedAt: f.date('firstReviewedAt'),
    ratingCounts: ratingCounts(f.map('ratingCounts')),
    lastLogId: f.string('lastLogId'),
    schedulerConfigId: f.string('schedulerConfigId'),
    updatedAt: f.date('updatedAt'),
  }
}

export function parseReviewLog(materialId: string, id: string, data: unknown): ReviewLog {
  const f = fields(data, `materials/${materialId}/reviewLogs/${id}`)
  const previous = f.nullableMap('previousState')
  const scheduler = f.map('scheduler')
  return {
    id: f.matches('id', id),
    materialId: f.matches('materialId', materialId),
    cardId: f.string('cardId'),
    reviewedAt: f.date('reviewedAt'),
    rating: f.oneOf('rating', REVIEW_RATINGS),
    previousState: previous ? snapshot(previous) : null,
    nextState: snapshot(f.map('nextState')),
    scheduler: {
      configId: scheduler.string('configId'),
      library: scheduler.string('library'),
      libraryVersion: scheduler.string('libraryVersion'),
    },
    durationMs: f.nullableNumber('durationMs'),
  }
}

export function parseProgress(materialId: string, data: unknown): MaterialProgress {
  const f = fields(data, `materials/${materialId}/progress/summary`)
  const byCategory: Record<string, CategoryProgress> = {}
  for (const [category, entry] of f.entries('byCategory')) {
    byCategory[category] = {
      totalCards: entry.integer('totalCards', 0),
      studiedCards: entry.integer('studiedCards', 0),
      ratingCounts: ratingCounts(entry.map('ratingCounts')),
    }
  }
  const daily: Record<string, DailyProgress> = {}
  for (const [dayKey, entry] of f.entries('daily')) {
    daily[dayKey] = { reviews: entry.integer('reviews', 0), newCards: entry.integer('newCards', 0) }
  }
  return {
    materialId: f.matches('materialId', materialId),
    totalCards: f.integer('totalCards', 0),
    studiedCards: f.integer('studiedCards', 0),
    newCursorOrder: f.integer('newCursorOrder', 0),
    ratingCounts: ratingCounts(f.map('ratingCounts')),
    byCategory,
    daily,
    lastReviewedAt: f.nullableDate('lastReviewedAt'),
    rebuiltAt: f.nullableDate('rebuiltAt'),
    updatedAt: f.date('updatedAt'),
  }
}

/** 設定：保存されていない項目は初期値で補う（古い形式の設定にも対応する） */
export function parseSettings(data: unknown, now: Date): AppSettings {
  const f = fields(data, 'settings/app')
  const defaults = defaultAppSettings(now)
  const read = <T>(key: keyof AppSettings, parse: () => T, fallback: T): T => (f.has(key) ? parse() : fallback)
  return {
    dayStartHour: read('dayStartHour', () => {
      const hour = f.integer('dayStartHour', 0)
      return hour <= 23 ? hour : f.fail('dayStartHour')
    }, defaults.dayStartHour),
    requestRetention: read('requestRetention', () => {
      const value = f.number('requestRetention')
      return value > 0 && value < 1 ? value : f.fail('requestRetention')
    }, defaults.requestRetention),
    maximumInterval: read('maximumInterval', () => f.integer('maximumInterval', 1), defaults.maximumInterval),
    enableFuzz: read('enableFuzz', () => f.boolean('enableFuzz'), defaults.enableFuzz),
    enableShortTerm: read('enableShortTerm', () => f.boolean('enableShortTerm'), defaults.enableShortTerm),
    learningSteps: read('learningSteps', () => f.steps('learningSteps'), defaults.learningSteps),
    relearningSteps: read('relearningSteps', () => f.steps('relearningSteps'), defaults.relearningSteps),
    fsrsWeights: read('fsrsWeights', () => (isNull(data, 'fsrsWeights') ? null : f.numberArray('fsrsWeights')), null),
    activeSchedulerConfigId: read('activeSchedulerConfigId', () => f.nullableString('activeSchedulerConfigId'), null),
    lastMaterialId: read('lastMaterialId', () => f.nullableString('lastMaterialId'), null),
    updatedAt: read('updatedAt', () => f.date('updatedAt'), now),
  }
}

function isNull(data: unknown, key: string): boolean {
  return isPlainObject(data) && data[key] === null
}

export function parseSchedulerConfig(id: string, data: unknown): SchedulerConfig {
  const f = fields(data, `schedulerConfigs/${id}`)
  const params = f.map('params')
  return {
    id: f.matches('id', id),
    library: f.string('library'),
    libraryVersion: f.string('libraryVersion'),
    params: {
      requestRetention: params.number('requestRetention'),
      maximumInterval: params.number('maximumInterval'),
      weights: params.numberArray('weights'),
      enableFuzz: params.boolean('enableFuzz'),
      enableShortTerm: params.boolean('enableShortTerm'),
      learningSteps: params.steps('learningSteps'),
      relearningSteps: params.steps('relearningSteps'),
    },
    createdAt: f.date('createdAt'),
  }
}
