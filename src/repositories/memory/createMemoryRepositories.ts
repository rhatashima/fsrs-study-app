import {
  AppError,
  applyReview,
  defaultAppSettings,
  emptyProgress,
  isValidCardId,
  rebuildProgress,
  sameSchedulerConfig,
  selectDueStates,
  selectNewCards,
  snapshotsEqual,
  type AppSettings,
  type Card,
  type MaterialProgress,
  type ReviewLog,
  type ReviewState,
  type SchedulerConfig,
  type StudyMaterial,
} from '../../domain'
import type {
  CardRepository,
  MaterialRepository,
  Repositories,
  ReviewRecord,
  ReviewRepository,
  SettingsRepository,
} from '../types'

/** 初期データ（開発用ダミーデータ・テスト用） */
export interface MemorySeed {
  materials?: readonly StudyMaterial[]
  cards?: readonly Card[]
  states?: readonly ReviewState[]
  logs?: readonly ReviewLog[]
  settings?: AppSettings
}

export interface MemoryRepositoryOptions {
  /** 現在時刻（テストで固定するため） */
  clock?: () => Date
}

/** 呼び出しごとに独立したデータを持つ（別のインスタンスとはデータを共有しない） */
interface MemoryStore {
  materials: Map<string, StudyMaterial>
  /** materialId → cardId → Card */
  cards: Map<string, Map<string, Card>>
  /** materialId → cardId → ReviewState */
  states: Map<string, Map<string, ReviewState>>
  /** materialId → 追記順の ReviewLog */
  logs: Map<string, ReviewLog[]>
  progress: Map<string, MaterialProgress>
  settings: AppSettings | null
  schedulerConfigs: Map<string, SchedulerConfig>
}

/** 保存・取得のたびにコピーし、呼び出し側の変更が保存済みデータに影響しないようにする */
const copy = <T>(value: T): T => structuredClone(value)

/** 同期処理を Promise にする（投げられたエラーは reject になる） */
function run<T>(fn: () => T): Promise<T> {
  try {
    return Promise.resolve(fn())
  } catch (error) {
    return Promise.reject(error instanceof Error ? error : new Error(String(error)))
  }
}

function innerMap<V>(outer: Map<string, Map<string, V>>, key: string): Map<string, V> {
  let inner = outer.get(key)
  if (!inner) {
    inner = new Map()
    outer.set(key, inner)
  }
  return inner
}

function valuesOf<V>(outer: Map<string, Map<string, V>>, key: string): V[] {
  return [...(outer.get(key)?.values() ?? [])]
}

/**
 * Firebase なしで動くリポジトリ一式。ページを再読み込みするとデータは消える。
 * Phase 3 の学習フローの開発と、各種テストに使う。
 */
export function createMemoryRepositories(
  seed: MemorySeed = {},
  options: MemoryRepositoryOptions = {},
): Repositories {
  const clock = options.clock ?? (() => new Date())
  const store: MemoryStore = {
    materials: new Map(),
    cards: new Map(),
    states: new Map(),
    logs: new Map(),
    progress: new Map(),
    settings: seed.settings ? copy(seed.settings) : null,
    schedulerConfigs: new Map(),
  }

  function requireMaterial(materialId: string): void {
    if (!store.materials.has(materialId)) {
      throw new AppError('not-found', `教材が見つかりません（${materialId}）。`)
    }
  }

  function validateCard(card: Card): void {
    requireMaterial(card.materialId)
    if (!isValidCardId(card.id)) {
      throw new AppError(
        'invalid-data',
        `カード id「${card.id}」は使えません。半角英数字・ハイフン・アンダースコア（100 文字以内）で指定してください。`,
      )
    }
    if (!Number.isInteger(card.order) || card.order < 1) {
      throw new AppError('invalid-data', `カード「${card.id}」の並び順（order）が不正です。`)
    }
  }

  function validateReviewRecord({ state, log }: ReviewRecord): void {
    requireMaterial(log.materialId)
    if (state.cardId !== log.cardId || state.materialId !== log.materialId) {
      throw new AppError('invalid-data', 'レビュー結果のカードが一致しません。')
    }
    if (state.lastLogId !== log.id) {
      throw new AppError('invalid-data', 'レビュー結果の履歴 id が一致しません。')
    }
    if (!snapshotsEqual(state, log.nextState)) {
      throw new AppError('invalid-data', 'レビュー結果の状態が履歴と一致しません。')
    }
    if ((store.logs.get(log.materialId) ?? []).some((existing) => existing.id === log.id)) {
      throw new AppError('conflict', 'このレビューはすでに保存されています。')
    }
  }

  function currentProgress(materialId: string): MaterialProgress {
    return store.progress.get(materialId) ?? emptyProgress(materialId, clock())
  }

  const materials: MaterialRepository = {
    list: () => run(() => [...store.materials.values()].map(copy)),
    get: (materialId) =>
      run(() => {
        const material = store.materials.get(materialId)
        return material ? copy(material) : null
      }),
    save: (material) =>
      run(() => {
        store.materials.set(material.id, copy(material))
      }),
  }

  const cards: CardRepository = {
    getByIds: (materialId, cardIds) =>
      run(() => {
        const byId = store.cards.get(materialId)
        return cardIds.flatMap((id) => {
          const card = byId?.get(id)
          return card ? [copy(card)] : []
        })
      }),
    listNewCandidates: (materialId, { afterOrder, limit }) =>
      run(() =>
        selectNewCards(valuesOf(store.cards, materialId), { materialId, afterOrder, limit }).map(copy),
      ),
    countActive: (materialId) =>
      run(() => valuesOf(store.cards, materialId).filter((card) => !card.isArchived).length),
    saveMany: (newCards) =>
      run(() => {
        // すべて検証してから保存する（途中で失敗したときに一部だけ保存されないように）
        newCards.forEach(validateCard)
        for (const card of newCards) {
          innerMap(store.cards, card.materialId).set(card.id, copy(card))
        }
      }),
  }

  const reviews: ReviewRepository = {
    getStates: (materialId, cardIds) =>
      run(() => {
        const byId = store.states.get(materialId)
        return cardIds.flatMap((id) => {
          const state = byId?.get(id)
          return state ? [copy(state)] : []
        })
      }),
    listDue: (materialId, { dueBefore, limit }) =>
      run(() =>
        selectDueStates(valuesOf(store.states, materialId), { materialId, dueBefore, limit }).map(copy),
      ),
    recordReview: (record) =>
      run(() => {
        // 検証がすべて通ってから 3 つを更新する（アトミック）
        validateReviewRecord(record)
        const { state, log, context } = record
        innerMap(store.states, state.materialId).set(state.cardId, copy(state))
        const logs = store.logs.get(log.materialId) ?? []
        logs.push(copy(log))
        store.logs.set(log.materialId, logs)
        store.progress.set(log.materialId, applyReview(currentProgress(log.materialId), log, context))
      }),
    listLogsForCard: (materialId, cardId, { limit }) =>
      run(() =>
        (store.logs.get(materialId) ?? [])
          .filter((log) => log.cardId === cardId)
          .sort((a, b) => b.reviewedAt.getTime() - a.reviewedAt.getTime())
          .slice(0, Math.max(0, limit))
          .map(copy),
      ),
    getProgress: (materialId) => run(() => copy(currentProgress(materialId))),
  }

  const settings: SettingsRepository = {
    getSettings: () => run(() => copy(store.settings ?? defaultAppSettings(clock()))),
    saveSettings: (next) =>
      run(() => {
        store.settings = copy(next)
      }),
    getSchedulerConfig: (configId) =>
      run(() => {
        const config = store.schedulerConfigs.get(configId)
        return config ? copy(config) : null
      }),
    saveSchedulerConfig: (config) =>
      run(() => {
        const existing = store.schedulerConfigs.get(config.id)
        if (!existing) {
          store.schedulerConfigs.set(config.id, copy(config))
        } else if (!sameSchedulerConfig(existing, config)) {
          throw new AppError('conflict', `FSRS 設定の記録（${config.id}）は変更できません。`)
        }
      }),
  }

  loadSeed(store, seed, clock())

  return { materials, cards, reviews, settings }
}

function loadSeed(store: MemoryStore, seed: MemorySeed, now: Date): void {
  for (const material of seed.materials ?? []) {
    store.materials.set(material.id, copy(material))
  }
  for (const card of seed.cards ?? []) {
    if (!store.materials.has(card.materialId)) {
      throw new AppError('invalid-data', `初期データのカード「${card.id}」の教材が存在しません。`)
    }
    const byId = innerMap(store.cards, card.materialId)
    if (byId.has(card.id)) {
      throw new AppError('invalid-data', `初期データのカード id「${card.id}」が重複しています。`)
    }
    byId.set(card.id, copy(card))
  }
  for (const state of seed.states ?? []) {
    innerMap(store.states, state.materialId).set(state.cardId, copy(state))
  }
  for (const log of seed.logs ?? []) {
    const logs = store.logs.get(log.materialId) ?? []
    logs.push(copy(log))
    store.logs.set(log.materialId, logs)
  }
  for (const materialId of store.materials.keys()) {
    store.progress.set(
      materialId,
      rebuildProgress({
        materialId,
        cards: valuesOf(store.cards, materialId),
        states: valuesOf(store.states, materialId),
        now,
      }),
    )
  }
}
