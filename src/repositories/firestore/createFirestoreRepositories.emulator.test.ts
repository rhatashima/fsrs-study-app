import {
  initializeTestEnvironment,
  type RulesTestContext,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing'
import { doc, getDoc, setDoc, Timestamp, type Firestore } from 'firebase/firestore'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import rulesTemplate from '../../../firestore.rules.template?raw'
import { AppError, CorruptedReviewStateError, rebuildProgress } from '../../domain'
import { makeCard, makeMaterial, makeReviewRecord, T0 } from '../../test/factories'
import { describeRepositoryContract } from '../repositoryContract'
import { createFirestoreRepositories } from './createFirestoreRepositories'

/*
 * Firestore 版リポジトリのテスト（Firestore Emulator + 本物の Security Rules。npm run test:rules で実行）。
 * リポジトリの書き込みが Rules を満たすことも、ここで確かめている。
 */

const OWNER = 'ownerUid123'
let env: RulesTestEnvironment

const firestoreOf = (context: RulesTestContext) => context.firestore() as unknown as Firestore

beforeAll(async () => {
  env = await initializeTestEnvironment({
    projectId: 'demo-rules-test',
    firestore: { rules: rulesTemplate.replace('__OWNER_UID__', OWNER) },
  })
})

afterAll(async () => {
  await env.cleanup()
})

async function createEmpty() {
  await env.clearFirestore()
  return createFirestoreRepositories(firestoreOf(env.authenticatedContext(OWNER)), OWNER, { clock: () => T0 })
}

/** ルールを無効にして直接読み書きする（壊れたデータを作る・保存された形を確かめるため） */
async function raw<T>(fn: (db: Firestore) => Promise<T>): Promise<T> {
  let result: T | undefined
  await env.withSecurityRulesDisabled(async (context) => {
    result = await fn(firestoreOf(context))
  })
  return result as T
}

async function setupWithCards() {
  const repos = await createEmpty()
  await repos.materials.save(makeMaterial({ id: 'm1' }))
  const cards = [makeCard({ id: 'c1', order: 1 }), makeCard({ id: 'c2', order: 2 })]
  await repos.cards.saveMany(cards)
  await repos.reviews.replaceProgress(rebuildProgress({ materialId: 'm1', cards, states: [], now: T0 }))
  return repos
}

const M = `users/${OWNER}/materials/m1`

// メモリ実装と同じ契約テスト
describeRepositoryContract('Firestore', createEmpty)

describe('Firestore 固有', () => {
  it('日時は Timestamp で保存し、読むと Date に戻る', async () => {
    const repos = await setupWithCards()
    const record = makeReviewRecord({ cardId: 'c1', logId: 'l1' })
    await repos.reviews.recordReview(record)

    const stored = await raw(async (db) => (await getDoc(doc(db, `${M}/reviewLogs/l1`))).data())
    expect(stored?.reviewedAt).toBeInstanceOf(Timestamp)
    expect((stored?.nextState as { due: unknown }).due).toBeInstanceOf(Timestamp)
    expect(stored?.previousState).toBeNull()

    const [log] = await repos.reviews.listLogsForCard('m1', 'c1', { limit: 1 })
    expect(log?.reviewedAt).toBeInstanceOf(Date)
    expect(log?.reviewedAt.getTime()).toBe(record.log.reviewedAt.getTime())
  })

  it('壊れた ReviewState を検出する（黙って除外しない）', async () => {
    const repos = await setupWithCards()
    await repos.reviews.recordReview(makeReviewRecord({ cardId: 'c1', logId: 'l1' }))
    await raw((db) => setDoc(doc(db, `${M}/reviewStates/c1`), { cardId: 'c1', materialId: 'm1', due: 'broken', suspended: false }))

    const error = await repos.reviews.getStates('m1', ['c1', 'c2']).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(CorruptedReviewStateError)
    expect((error as CorruptedReviewStateError).cardIds).toEqual(['c1'])
    expect((error as CorruptedReviewStateError).message).toContain('学習履歴から復元できます')
  })

  it('壊れた ReviewState のカードにはレビューを保存しない', async () => {
    const repos = await setupWithCards()
    const first = makeReviewRecord({ cardId: 'c1', logId: 'l1' })
    await repos.reviews.recordReview(first)
    await raw((db) => setDoc(doc(db, `${M}/reviewStates/c1`), { broken: true }))
    const second = makeReviewRecord({ cardId: 'c1', logId: 'l2', previous: first.log.nextState })
    await expect(repos.reviews.recordReview(second)).rejects.toBeInstanceOf(CorruptedReviewStateError)
    expect(await repos.reviews.listLogsForCard('m1', 'c1', { limit: 10 })).toHaveLength(1)
  })

  it('形式が壊れた ReviewLog は履歴の一覧に含めない', async () => {
    const repos = await setupWithCards()
    await repos.reviews.recordReview(makeReviewRecord({ cardId: 'c1', logId: 'l1' }))
    await raw((db) =>
      setDoc(doc(db, `${M}/reviewLogs/broken`), { id: 'broken', materialId: 'm1', cardId: 'c1', reviewedAt: Timestamp.fromDate(T0) }),
    )
    expect((await repos.reviews.listLogsForCard('m1', 'c1', { limit: 10 })).map((l) => l.id)).toEqual(['l1'])
  })

  it('形式が正しくない教材データは invalid-data（日本語のエラー）', async () => {
    const repos = await createEmpty()
    await raw((db) => setDoc(doc(db, `users/${OWNER}/materials/bad`), { id: 'bad', title: 123 }))
    await expect(repos.materials.list()).rejects.toMatchObject({ kind: 'invalid-data' })
  })

  it('同じレビューを同時に 2 回送っても、履歴と集計は 1 回分だけ', async () => {
    const repos = await setupWithCards()
    const record = makeReviewRecord({ cardId: 'c1', logId: 'l1' })
    await Promise.all([repos.reviews.recordReview(record), repos.reviews.recordReview(structuredClone(record))])
    expect(await repos.reviews.listLogsForCard('m1', 'c1', { limit: 10 })).toHaveLength(1)
    expect((await repos.reviews.getProgress('m1')).ratingCounts.good).toBe(1)
  })

  it('Owner 以外の UID では読み書きが拒否され、日本語の AppError になる', async () => {
    await setupWithCards()
    const stranger = createFirestoreRepositories(firestoreOf(env.authenticatedContext('strangerUid')), OWNER)
    const error = await stranger.materials.list().catch((e: unknown) => e)
    expect(error).toBeInstanceOf(AppError)
    expect(error).toMatchObject({ kind: 'permission-denied' })
    expect((error as AppError).message).toContain('アクセスが拒否されました')
  })

  it('未ログインでは拒否される', async () => {
    await setupWithCards()
    const anonymous = createFirestoreRepositories(firestoreOf(env.unauthenticatedContext()), OWNER)
    await expect(anonymous.cards.getByIds('m1', ['c1'])).rejects.toMatchObject({ kind: 'permission-denied' })
  })
})
