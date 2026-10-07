import {
  collection,
  doc,
  documentId,
  getCountFromServer,
  getDoc,
  getDocs,
  limit as limitTo,
  orderBy,
  query,
  runTransaction,
  setDoc,
  Timestamp,
  where,
  writeBatch,
  type Firestore,
  type QueryDocumentSnapshot,
} from 'firebase/firestore'
import {
  AppError,
  applyReview,
  CorruptedReviewStateError,
  defaultAppSettings,
  emptyProgress,
  sameSchedulerConfig,
  type Card,
  type ReviewLog,
  type ReviewState,
} from '../../domain'
import type {
  CardRepository,
  MaterialRepository,
  Repositories,
  ReviewRepository,
  SettingsRepository,
} from '../types'
import { perfAsync } from '../../lib/perf'
import { assertConsistentRecord, assertRestorableState, assertValidCard, decideReviewWrite } from '../writeRules'
import { guard } from './errors'
import { toFirestoreData } from './serialization'
import {
  parseCard,
  parseMaterial,
  parseProgress,
  parseReviewLog,
  parseReviewState,
  parseSchedulerConfig,
  parseSettings,
} from './validation'

/** Firestore の `in` クエリで一度に指定できる値の数 */
const IN_QUERY_LIMIT = 30
/** 1 回の一括書き込みの上限 */
const BATCH_LIMIT = 500

function chunk<T>(items: readonly T[], size: number): T[][] {
  const chunks: T[][] = []
  for (let i = 0; i < items.length; i += size) chunks.push(items.slice(i, i + size))
  return chunks
}

export interface FirestoreRepositoryOptions {
  /** 現在時刻（空の集計・既定の設定を作るときに使う） */
  clock?: () => Date
}

/**
 * Firestore 版のリポジトリ（docs/DATA_MODEL.md）。データはすべて users/{uid}/ の下に置く。
 * Firestore の型（Timestamp など）はこのファイルと serialization / validation の外に出さない。
 */
export function createFirestoreRepositories(
  db: Firestore,
  uid: string,
  options: FirestoreRepositoryOptions = {},
): Repositories {
  const clock = options.clock ?? (() => new Date())
  const base = `users/${uid}`

  /** Firestore の 1 回の読み取りを計測する（計測が無効なら何もしない）。docs は課金される読み取り数の目安 */
  const timed = <T>(label: string, fn: () => Promise<T>, docs: (result: T) => number) =>
    perfAsync(`firestore:${label}`, fn, (result) => ({ docs: docs(result) }))
  const queryDocs = (snapshot: { docs: unknown[] }) => Math.max(1, snapshot.docs.length)

  const materialRef = (materialId: string) => doc(db, base, 'materials', materialId)
  const cardsCol = (materialId: string) => collection(db, base, 'materials', materialId, 'cards')
  const statesCol = (materialId: string) => collection(db, base, 'materials', materialId, 'reviewStates')
  const logsCol = (materialId: string) => collection(db, base, 'materials', materialId, 'reviewLogs')
  const progressRef = (materialId: string) => doc(db, base, 'materials', materialId, 'progress', 'summary')
  const settingsRef = doc(db, base, 'settings', 'app')
  const configRef = (configId: string) => doc(db, base, 'schedulerConfigs', configId)

  /** ReviewState を検証して読む。壊れたものがあれば、まとめて CorruptedReviewStateError にする */
  function parseStates(materialId: string, docs: QueryDocumentSnapshot[]): ReviewState[] {
    const states: ReviewState[] = []
    const corrupted: string[] = []
    for (const snapshot of docs) {
      try {
        states.push(parseReviewState(materialId, snapshot.id, snapshot.data()))
      } catch (error) {
        corrupted.push(snapshot.id)
        if (!(error instanceof AppError)) throw error
      }
    }
    if (corrupted.length > 0) throw new CorruptedReviewStateError(materialId, corrupted)
    return states
  }

  /** id の一覧を 30 件ずつの `in` クエリで取得する */
  async function getManyById(
    col: ReturnType<typeof collection>,
    ids: readonly string[],
  ): Promise<QueryDocumentSnapshot[]> {
    const unique = [...new Set(ids)]
    const results = await Promise.all(
      chunk(unique, IN_QUERY_LIMIT).map((part) =>
        timed(`${col.id}.byIds`, () => getDocs(query(col, where(documentId(), 'in', part))), queryDocs),
      ),
    )
    return results.flatMap((snapshot) => snapshot.docs)
  }

  async function requireMaterial(materialId: string): Promise<void> {
    if (!(await timed('material.exists', () => getDoc(materialRef(materialId)), () => 1)).exists()) {
      throw new AppError('not-found', `教材が見つかりません（${materialId}）。`)
    }
  }

  const materials: MaterialRepository = {
    list: () =>
      guard(async () => {
        const snapshot = await timed('materials.list', () => getDocs(collection(db, base, 'materials')), queryDocs)
        return snapshot.docs.map((d) => parseMaterial(d.id, d.data()))
      }),
    get: (materialId) =>
      guard(async () => {
        const snapshot = await timed('material.get', () => getDoc(materialRef(materialId)), () => 1)
        return snapshot.exists() ? parseMaterial(snapshot.id, snapshot.data()) : null
      }),
    save: (material) => guard(() => setDoc(materialRef(material.id), toFirestoreData(material))),
  }

  const cards: CardRepository = {
    getByIds: (materialId, cardIds) =>
      guard(async () => {
        const docs = await getManyById(cardsCol(materialId), cardIds)
        const byId = new Map(docs.map((d) => [d.id, parseCard(materialId, d.id, d.data())]))
        return cardIds.flatMap((id) => {
          const card = byId.get(id)
          return card ? [card] : []
        })
      }),
    listNewCandidates: (materialId, { afterOrder, limit }) =>
      guard(async () => {
        if (limit <= 0) return []
        const snapshot = await timed('cards.newCandidates', () => getDocs(
          query(
            cardsCol(materialId),
            where('isArchived', '==', false),
            where('order', '>', afterOrder),
            orderBy('order'),
            limitTo(limit),
          ),
        ), queryDocs)
        return snapshot.docs.map((d) => parseCard(materialId, d.id, d.data()))
      }),
    countActive: (materialId) =>
      guard(async () => {
        const snapshot = await timed('cards.count', () => getCountFromServer(query(cardsCol(materialId), where('isArchived', '==', false))), () => 1)
        return snapshot.data().count
      }),
    saveMany: (newCards) =>
      guard(async () => {
        // すべて検証してから保存する
        newCards.forEach(assertValidCard)
        await Promise.all([...new Set(newCards.map((card) => card.materialId))].map(requireMaterial))
        // 500 件ごとの一括書き込み（500 件以下ならすべて保存されるか、何も保存されない）
        for (const part of chunk<Card>(newCards, BATCH_LIMIT)) {
          const batch = writeBatch(db)
          for (const card of part) batch.set(doc(cardsCol(card.materialId), card.id), toFirestoreData(card))
          await batch.commit()
        }
      }),
  }

  const reviews: ReviewRepository = {
    getStates: (materialId, cardIds) =>
      guard(async () => {
        const states = parseStates(materialId, await getManyById(statesCol(materialId), cardIds))
        const byId = new Map(states.map((state) => [state.cardId, state]))
        return cardIds.flatMap((id) => {
          const state = byId.get(id)
          return state ? [state] : []
        })
      }),
    listDue: (materialId, { dueBefore, limit }) =>
      guard(async () => {
        const constraints = [
          where('suspended', '==', false),
          where('due', '<', Timestamp.fromDate(dueBefore)),
          orderBy('due'),
          ...(limit === undefined ? [] : [limitTo(Math.max(1, limit))]),
        ]
        if (limit !== undefined && limit <= 0) return []
        const snapshot = await timed('reviewStates.due', () => getDocs(query(statesCol(materialId), ...constraints)), queryDocs)
        return parseStates(materialId, snapshot.docs)
      }),
    recordReview: (record) =>
      guard(async () => {
        assertConsistentRecord(record)
        const { state, log, context } = record
        const stateRef = doc(statesCol(state.materialId), state.cardId)
        const logRef = doc(logsCol(log.materialId), log.id)
        // ReviewState・ReviewLog・集計を読み、整合性を確かめてから 3 つを同時に書く。
        // 他の端末と同時に更新した場合、Firestore がトランザクションをやり直す。
        let attempts = 0
        await timed('tx.recordReview', () => runTransaction(db, async (tx) => {
          attempts += 1
          const [logSnap, stateSnap, progressSnap] = await Promise.all([
            tx.get(logRef),
            tx.get(stateRef),
            tx.get(progressRef(log.materialId)),
          ])
          let existingLog: ReviewLog | null = null
          if (logSnap.exists()) {
            try {
              existingLog = parseReviewLog(log.materialId, logSnap.id, logSnap.data())
            } catch {
              throw new AppError('conflict', 'このレビューの記録が別の内容ですでに保存されています。画面を再読み込みしてください。')
            }
          }
          let stored: ReviewState | null = null
          if (stateSnap.exists()) {
            try {
              stored = parseReviewState(state.materialId, stateSnap.id, stateSnap.data())
            } catch (error) {
              throw new CorruptedReviewStateError(state.materialId, [state.cardId], { cause: error })
            }
          }
          if (decideReviewWrite(record, existingLog, stored) === 'duplicate') return

          const progress = progressSnap.exists()
            ? parseProgress(log.materialId, progressSnap.data())
            : emptyProgress(log.materialId, log.reviewedAt)
          tx.set(logRef, toFirestoreData(log))
          tx.set(stateRef, toFirestoreData(state))
          tx.set(progressRef(log.materialId), toFirestoreData(applyReview(progress, log, context)))
        }), () => 3 * attempts)
      }),
    listLogsForCard: (materialId, cardId, { limit }) =>
      guard(async () => {
        if (limit <= 0) return []
        const snapshot = await timed('reviewLogs.forCard', () => getDocs(
          query(logsCol(materialId), where('cardId', '==', cardId), orderBy('reviewedAt', 'desc'), limitTo(limit)),
        ), queryDocs)
        // 形式が壊れた履歴は含めない（復元には有効な履歴だけを使う）
        return snapshot.docs.flatMap((d) => {
          try {
            return [parseReviewLog(materialId, d.id, d.data())]
          } catch {
            return []
          }
        })
      }),
    findCardsWithLogs: (materialId, cardIds) =>
      guard(async () => {
        const unique = [...new Set(cardIds)]
        const results = await Promise.all(
          chunk(unique, IN_QUERY_LIMIT).map((part) =>
            timed('reviewLogs.cardIn', () => getDocs(query(logsCol(materialId), where('cardId', 'in', part))), queryDocs),
          ),
        )
        const withLogs = new Set(results.flatMap((s) => s.docs.map((d) => d.get('cardId') as unknown)))
        return cardIds.filter((id) => withLogs.has(id))
      }),
    restoreState: (state) =>
      guard(async () => {
        await runTransaction(db, async (tx) => {
          const logSnap = await tx.get(doc(logsCol(state.materialId), state.lastLogId))
          const log = logSnap.exists() ? parseReviewLog(state.materialId, logSnap.id, logSnap.data()) : null
          assertRestorableState(state, log)
          tx.set(doc(statesCol(state.materialId), state.cardId), toFirestoreData(state))
        })
      }),
    getProgress: (materialId) =>
      guard(async () => {
        const snapshot = await timed('progress.get', () => getDoc(progressRef(materialId)), () => 1)
        return snapshot.exists() ? parseProgress(materialId, snapshot.data()) : emptyProgress(materialId, clock())
      }),
    replaceProgress: (progress) =>
      guard(() => setDoc(progressRef(progress.materialId), toFirestoreData(progress))),
  }

  const settings: SettingsRepository = {
    getSettings: () =>
      guard(async () => {
        const snapshot = await timed('settings.get', () => getDoc(settingsRef), () => 1)
        return snapshot.exists() ? parseSettings(snapshot.data(), clock()) : defaultAppSettings(clock())
      }),
    saveSettings: (next) => guard(() => setDoc(settingsRef, toFirestoreData(next))),
    getSchedulerConfig: (configId) =>
      guard(async () => {
        const snapshot = await timed('schedulerConfig.get', () => getDoc(configRef(configId)), () => 1)
        return snapshot.exists() ? parseSchedulerConfig(snapshot.id, snapshot.data()) : null
      }),
    saveSchedulerConfig: (config) =>
      guard(async () => {
        // 作成のみ（不変）。すでにあれば内容を比べるだけで、上書きしない
        await runTransaction(db, async (tx) => {
          const snapshot = await tx.get(configRef(config.id))
          if (!snapshot.exists()) {
            tx.set(configRef(config.id), toFirestoreData(config))
            return
          }
          if (!sameSchedulerConfig(parseSchedulerConfig(snapshot.id, snapshot.data()), config)) {
            throw new AppError('conflict', `FSRS 設定の記録（${config.id}）は変更できません。`)
          }
        })
      }),
  }

  return { materials, cards, reviews, settings }
}
