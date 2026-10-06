import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestContext,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing'
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  query,
  setDoc,
  Timestamp,
  updateDoc,
  where,
  writeBatch,
  type Firestore,
} from 'firebase/firestore'
import { readFileSync } from 'node:fs'
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest'

/*
 * Security Rules のテスト（Firestore Emulator を使う。実際の Firestore には接続しない）。
 * firestore.rules.template の __OWNER_UID__ をテスト用の UID に置き換えて読み込む。
 */

const OWNER = 'ownerUid123'
const STRANGER = 'strangerUid456'
const BASE = `users/${OWNER}`
const M = `${BASE}/materials/m1`

const template = readFileSync(new URL('../../firestore.rules.template', import.meta.url), 'utf8')

let env: RulesTestEnvironment

const now = Timestamp.fromDate(new Date('2026-10-06T10:00:00+09:00'))
const later = Timestamp.fromDate(new Date('2026-10-07T10:00:00+09:00'))

const ratingCounts = { again: 0, hard: 0, good: 1, easy: 0 }
const snapshot = {
  phase: 'learning',
  due: later,
  stability: 2.3,
  difficulty: 2.1,
  scheduledDays: 0,
  learningSteps: 1,
  reps: 1,
  lapses: 0,
  lastReviewedAt: now,
}

const data = {
  material: { id: 'm1', title: '教材', description: '', isActive: true, newCardsPerDay: 10, createdAt: now, updatedAt: now },
  card: (id: string) => ({
    id,
    materialId: 'm1',
    question: 'Q',
    answer: 'A',
    explanation: '',
    category: '石垣',
    tags: [],
    order: 1,
    isArchived: false,
    examDifficulty: 3,
    createdAt: now,
    updatedAt: now,
  }),
  log: (id: string, cardId = 'c1') => ({
    id,
    materialId: 'm1',
    cardId,
    reviewedAt: now,
    rating: 'good',
    previousState: null,
    nextState: snapshot,
    scheduler: { configId: 'ts-fsrs@5.4.2-abc', library: 'ts-fsrs', libraryVersion: '5.4.2' },
    durationMs: 1200,
  }),
  state: (cardId: string, lastLogId: string) => ({
    ...snapshot,
    cardId,
    materialId: 'm1',
    suspended: false,
    firstReviewedAt: now,
    ratingCounts,
    lastLogId,
    schedulerConfigId: 'ts-fsrs@5.4.2-abc',
    updatedAt: now,
  }),
  progress: {
    materialId: 'm1',
    totalCards: 3,
    studiedCards: 1,
    newCursorOrder: 1,
    ratingCounts,
    byCategory: { 石垣: { totalCards: 3, studiedCards: 1, ratingCounts } },
    daily: { '2026-10-06': { reviews: 1, newCards: 1 } },
    lastReviewedAt: now,
    rebuiltAt: null,
    updatedAt: now,
  },
  settings: {
    dayStartHour: 4,
    requestRetention: 0.9,
    maximumInterval: 36500,
    enableFuzz: true,
    enableShortTerm: true,
    learningSteps: ['1m', '10m'],
    relearningSteps: ['10m'],
    fsrsWeights: null,
    activeSchedulerConfigId: null,
    lastMaterialId: null,
    updatedAt: now,
  },
  config: (id: string) => ({
    id,
    library: 'ts-fsrs',
    libraryVersion: '5.4.2',
    params: { requestRetention: 0.9, maximumInterval: 36500, weights: [0.1, 0.2], enableFuzz: true, enableShortTerm: true, learningSteps: ['1m'], relearningSteps: ['10m'] },
    createdAt: now,
  }),
}

const db = (context: RulesTestContext) => context.firestore() as unknown as Firestore
const owner = () => db(env.authenticatedContext(OWNER))
const stranger = () => db(env.authenticatedContext(STRANGER))
const anonymous = () => db(env.unauthenticatedContext())

beforeAll(async () => {
  env = await initializeTestEnvironment({
    projectId: 'demo-rules-test',
    firestore: { rules: template.replace('__OWNER_UID__', OWNER) },
  })
})

afterAll(async () => {
  await env.cleanup()
})

beforeEach(async () => {
  await env.clearFirestore()
  // 既存データ（ルールを無効にして直接書き込む）
  await env.withSecurityRulesDisabled(async (context) => {
    const d = db(context)
    await setDoc(doc(d, `${BASE}/settings/app`), data.settings)
    await setDoc(doc(d, `${BASE}/schedulerConfigs/ts-fsrs@5.4.2-abc`), data.config('ts-fsrs@5.4.2-abc'))
    await setDoc(doc(d, M), data.material)
    await setDoc(doc(d, `${M}/cards/c1`), data.card('c1'))
    await setDoc(doc(d, `${M}/reviewLogs/l1`), data.log('l1'))
    await setDoc(doc(d, `${M}/reviewStates/c1`), data.state('c1', 'l1'))
    await setDoc(doc(d, `${M}/progress/summary`), data.progress)
  })
})

const EXISTING_PATHS = [
  `${BASE}/settings/app`,
  `${BASE}/schedulerConfigs/ts-fsrs@5.4.2-abc`,
  M,
  `${M}/cards/c1`,
  `${M}/reviewStates/c1`,
  `${M}/reviewLogs/l1`,
  `${M}/progress/summary`,
]

describe('未ログイン', () => {
  it.each(EXISTING_PATHS)('%s を読めない', async (path) => {
    await assertFails(getDoc(doc(anonymous(), path)))
  })

  it('書き込めない', async () => {
    await assertFails(setDoc(doc(anonymous(), `${M}/cards/c2`), data.card('c2')))
    await assertFails(setDoc(doc(anonymous(), M), data.material))
  })
})

describe('Owner 以外のアカウント', () => {
  it.each(EXISTING_PATHS)('Owner の %s を読めない', async (path) => {
    await assertFails(getDoc(doc(stranger(), path)))
  })

  it('Owner のデータに書き込めない', async () => {
    await assertFails(setDoc(doc(stranger(), `${M}/cards/c2`), data.card('c2')))
    await assertFails(setDoc(doc(stranger(), `${M}/reviewLogs/l9`), data.log('l9')))
    await assertFails(setDoc(doc(stranger(), `${BASE}/settings/app`), data.settings))
  })

  it('自分の UID の下にも書き込めない（利用者は Owner だけ）', async () => {
    await assertFails(setDoc(doc(stranger(), `users/${STRANGER}/materials/m1`), data.material))
    await assertFails(getDoc(doc(stranger(), `users/${STRANGER}/materials/m1`)))
  })
})

describe('Owner', () => {
  it.each(EXISTING_PATHS)('%s を読める', async (path) => {
    await assertSucceeds(getDoc(doc(owner(), path)))
  })

  it('アプリが使うクエリを実行できる', async () => {
    const d = owner()
    await assertSucceeds(getDocs(collection(d, `${BASE}/materials`)))
    await assertSucceeds(
      getDocs(query(collection(d, `${M}/reviewStates`), where('suspended', '==', false), where('due', '<', later))),
    )
    await assertSucceeds(getDocs(query(collection(d, `${M}/cards`), where('isArchived', '==', false), where('order', '>', 0))))
    await assertSucceeds(getDocs(query(collection(d, `${M}/reviewLogs`), where('cardId', '==', 'c1'))))
  })

  it('教材・カード・設定・集計を作成・更新できる', async () => {
    const d = owner()
    await assertSucceeds(setDoc(doc(d, `${BASE}/materials/m2`), { ...data.material, id: 'm2' }))
    await assertSucceeds(setDoc(doc(d, M), { ...data.material, title: '改名' }))
    await assertSucceeds(setDoc(doc(d, `${M}/cards/c2`), data.card('c2')))
    await assertSucceeds(updateDoc(doc(d, `${M}/cards/c1`), { question: '修正', updatedAt: later }))
    await assertSucceeds(setDoc(doc(d, `${BASE}/settings/app`), { ...data.settings, dayStartHour: 5 }))
    await assertSucceeds(setDoc(doc(d, `${M}/progress/summary`), { ...data.progress, totalCards: 4 }))
  })

  it('レビュー（ReviewLog の作成 + ReviewState + 集計）を同時に保存できる', async () => {
    const d = owner()
    const batch = writeBatch(d)
    batch.set(doc(d, `${M}/reviewLogs/l2`), { ...data.log('l2'), previousState: snapshot })
    batch.set(doc(d, `${M}/reviewStates/c1`), data.state('c1', 'l2'))
    batch.set(doc(d, `${M}/progress/summary`), data.progress)
    await assertSucceeds(batch.commit())
  })

  it('存在する ReviewLog を参照する ReviewState は保存できる（履歴からの復元）', async () => {
    await assertSucceeds(setDoc(doc(owner(), `${M}/reviewStates/c1`), { ...data.state('c1', 'l1'), updatedAt: later }))
  })

  it('存在しない ReviewLog を参照する ReviewState は保存できない', async () => {
    await assertFails(setDoc(doc(owner(), `${M}/reviewStates/c1`), data.state('c1', 'missing-log')))
    await assertFails(setDoc(doc(owner(), `${M}/reviewStates/c2`), data.state('c2', 'missing-log')))
  })

  it('FSRS 設定の記録を作成できる', async () => {
    await assertSucceeds(setDoc(doc(owner(), `${BASE}/schedulerConfigs/new-config`), data.config('new-config')))
  })
})

describe('ReviewLog は追記のみ', () => {
  it('作成できる', async () => {
    await assertSucceeds(setDoc(doc(owner(), `${M}/reviewLogs/l2`), data.log('l2')))
  })

  it('既存の ReviewLog を上書き・更新できない', async () => {
    await assertFails(setDoc(doc(owner(), `${M}/reviewLogs/l1`), { ...data.log('l1'), rating: 'easy' }))
    await assertFails(updateDoc(doc(owner(), `${M}/reviewLogs/l1`), { rating: 'again' }))
  })

  it('削除できない', async () => {
    await assertFails(deleteDoc(doc(owner(), `${M}/reviewLogs/l1`)))
  })

  it.each([
    ['評価が不正', { rating: 'perfect' }],
    ['id がドキュメント id と違う', { id: 'other' }],
    ['想定外の項目がある', { extra: true }],
    ['nextState の学習段階が不正', { nextState: { ...snapshot, phase: 'unknown' } }],
    ['日時が Timestamp でない', { reviewedAt: '2026-10-06' }],
  ])('形式が正しくない ReviewLog は作成できない（%s）', async (_label, change) => {
    await assertFails(setDoc(doc(owner(), `${M}/reviewLogs/l3`), { ...data.log('l3'), ...change }))
  })
})

describe('不変・削除禁止', () => {
  it('FSRS 設定の記録は変更・削除できない', async () => {
    const ref = doc(owner(), `${BASE}/schedulerConfigs/ts-fsrs@5.4.2-abc`)
    await assertFails(setDoc(ref, { ...data.config('ts-fsrs@5.4.2-abc'), libraryVersion: '9.9.9' }))
    await assertFails(deleteDoc(ref))
  })

  it.each([`${M}/cards/c1`, `${M}/reviewStates/c1`, M, `${M}/progress/summary`, `${BASE}/settings/app`])(
    '%s は削除できない',
    async (path) => {
      await assertFails(deleteDoc(doc(owner(), path)))
    },
  )
})

describe('形式の検証', () => {
  it.each([
    ['カードの問題の難易度が 1〜5 の外', `${M}/cards/c2`, { ...data.card('c2'), examDifficulty: 6 }],
    ['カードの id がドキュメント id と違う', `${M}/cards/c2`, data.card('c3')],
    ['カードの並び順が 0', `${M}/cards/c2`, { ...data.card('c2'), order: 0 }],
    ['教材の id がドキュメント id と違う', `${BASE}/materials/m2`, data.material],
    ['集計のドキュメント id が summary でない', `${M}/progress/other`, data.progress],
    ['集計の件数が負', `${M}/progress/summary`, { ...data.progress, totalCards: -1 }],
    ['設定のドキュメント id が app でない', `${BASE}/settings/other`, data.settings],
    ['設定の区切り時刻が範囲外', `${BASE}/settings/app`, { ...data.settings, dayStartHour: 24 }],
  ])('%s', async (_label, path, value) => {
    await assertFails(setDoc(doc(owner(), path), value))
  })
})

describe('不明なコレクション', () => {
  it.each([
    'unknown/doc',
    `users/${OWNER}`,
    `${BASE}/unknown/doc`,
    `${M}/unknown/doc`,
    `${M}/examSessions/s1`,
  ])('%s は Owner でも読み書きできない', async (path) => {
    await assertFails(getDoc(doc(owner(), path)))
    await assertFails(setDoc(doc(owner(), path), { a: 1 }))
  })
})
