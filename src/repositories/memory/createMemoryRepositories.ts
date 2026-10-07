import {
  AppError,
  applyReview,
  defaultAppSettings,
  emptyProgress,
  rebuildProgress,
  sameSchedulerConfig,
  selectDueStates,
  selectNewCards,
  type AppSettings,
  type Card,
  type MaterialProgress,
  type ReviewLog,
  type ReviewState,
  type SchedulerConfig,
  type StudyMaterial,
} from '../../domain'
import { assertConsistentRecord, assertRestorableState, assertValidCard, decideReviewWrite } from '../writeRules'
import type {
  CardRepository,
  MaterialRepository,
  Repositories,
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
    assertValidCard(card)
  }

  function findLog(materialId: string, logId: string): ReviewLog | null {
    return (store.logs.get(materialId) ?? []).find((log) => log.id === logId) ?? null
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
    getMaxOrder: (materialId) =>
      run(() => valuesOf(store.cards, materialId).reduce((max, card) => Math.max(max, card.order), 0)),
    listAll: (materialId) => run(() => valuesOf(store.cards, materialId).map(copy)),
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
        requireMaterial(record.log.materialId)
        assertConsistentRecord(record)
        const { state, log, context } = record
        const stored = store.states.get(state.materialId)?.get(state.cardId) ?? null
        if (decideReviewWrite(record, findLog(log.materialId, log.id), stored) === 'duplicate') return
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
    listAllStates: (materialId) => run(() => valuesOf(store.states, materialId).map(copy)),
    findCardsWithLogs: (materialId, cardIds) =>
      run(() => {
        const withLogs = new Set((store.logs.get(materialId) ?? []).map((log) => log.cardId))
        return cardIds.filter((id) => withLogs.has(id))
      }),
    restoreState: (state) =>
      run(() => {
        requireMaterial(state.materialId)
        assertRestorableState(state, findLog(state.materialId, state.lastLogId))
        innerMap(store.states, state.materialId).set(state.cardId, copy(state))
      }),
    getProgress: (materialId) => run(() => copy(currentProgress(materialId))),
    replaceProgress: (progress) =>
      run(() => {
        requireMaterial(progress.materialId)
        store.progress.set(progress.materialId, copy(progress))
      }),
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
