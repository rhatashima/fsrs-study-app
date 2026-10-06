// @vitest-environment node
import { describe, expect, it } from 'vitest'
import {
  CorruptedReviewStateError,
  defaultAppSettings,
  nextStudyItem,
  toSchedulingSnapshot,
  type Card,
  type ReviewState,
} from '../domain'
import { createMemoryRepositories } from '../repositories/memory/createMemoryRepositories'
import { makeCard, makeMaterial } from '../test/factories'
import { restoreReviewStates } from './restoreService'
import {
  loadStudyOverview,
  prepareScheduler,
  selectCurrentMaterial,
  startStudySession,
  submitReview,
} from './studyService'

const local = (d: number, h: number, min = 0) => new Date(2026, 9, d, h, min)
const T = local(6, 10) // 2026-10-06 10:00（学習日 10/6）

function setup(options: { newCardsPerDay?: number; cards?: Card[] } = {}) {
  return createMemoryRepositories(
    {
      materials: [makeMaterial({ id: 'm1', newCardsPerDay: options.newCardsPerDay ?? 3 })],
      cards:
        options.cards ??
        Array.from({ length: 5 }, (_, i) =>
          makeCard({ id: `c${i + 1}`, order: i + 1, question: `問題${i + 1}` }),
        ),
    },
    { clock: () => T },
  )
}

describe('prepareScheduler', () => {
  it('FSRS 設定の記録を保存し、設定に有効な設定 id を記録する（同じ設定なら 2 回目は書き込まない）', async () => {
    const repos = setup()
    const settings = await repos.settings.getSettings()
    const scheduler = await prepareScheduler(repos, settings, T)

    expect(await repos.settings.getSchedulerConfig(scheduler.config.id)).toEqual(scheduler.config)
    const saved = await repos.settings.getSettings()
    expect(saved.activeSchedulerConfigId).toBe(scheduler.config.id)

    // 2 回目：別の時刻でも同じ設定なので、既存の記録は変わらない
    const again = await prepareScheduler(repos, saved, local(7, 9))
    expect(again.config.id).toBe(scheduler.config.id)
    expect((await repos.settings.getSchedulerConfig(scheduler.config.id))?.createdAt).toEqual(T)
  })
})

describe('selectCurrentMaterial', () => {
  it('前回の教材があればそれ、なければ最初の有効な教材', async () => {
    const repos = createMemoryRepositories({
      materials: [
        makeMaterial({ id: 'inactive', isActive: false }),
        makeMaterial({ id: 'a' }),
        makeMaterial({ id: 'b' }),
      ],
    })
    expect((await selectCurrentMaterial(repos))?.id).toBe('a')
    await repos.settings.saveSettings({ ...defaultAppSettings(T), lastMaterialId: 'b' })
    expect((await selectCurrentMaterial(repos))?.id).toBe('b')
  })
})

describe('学習の一連の流れ（メモリ上のリポジトリ）', () => {
  it('新規カード表示 → Good → ReviewState 保存・ReviewLog 追加・集計更新 → 次のカード', async () => {
    const repos = setup()
    const { context, session } = await startStudySession(repos, 'm1', T)

    // 新規カードが order 順に、1 日の上限（3 枚）まで
    expect(session.newCardIds).toEqual(['c1', 'c2', 'c3'])
    const first = nextStudyItem(session, T)
    expect(first).toMatchObject({ kind: 'new', card: { id: 'c1' }, state: null })
    if (first.kind === 'done') throw new Error('unreachable')

    // 答えを見たとき（preview）だけでは何も保存されない
    context.scheduler.preview(null, T)
    expect(await repos.reviews.getStates('m1', ['c1'])).toEqual([])

    const reviewedAt = local(6, 10, 1)
    const result = await submitReview(
      repos,
      context,
      session,
      { card: first.card, rating: 'good', reviewedAt, durationMs: 60_000 },
      'log-1',
    )

    const [state] = await repos.reviews.getStates('m1', ['c1'])
    expect(state).toMatchObject({ phase: 'learning', lastLogId: 'log-1', firstReviewedAt: reviewedAt })
    expect(state?.due).toEqual(local(6, 10, 11))

    const logs = await repos.reviews.listLogsForCard('m1', 'c1', { limit: 10 })
    expect(logs).toHaveLength(1)
    expect(logs[0]).toMatchObject({ rating: 'good', reviewedAt, previousState: null })
    expect(logs[0]?.scheduler).toMatchObject({ configId: context.scheduler.config.id, libraryVersion: '5.4.2' })

    const progress = await repos.reviews.getProgress('m1')
    expect(progress).toMatchObject({ studiedCards: 1, newCursorOrder: 1 })
    expect(progress.daily['2026-10-06']).toEqual({ reviews: 1, newCards: 1 })

    // 次のカード（c1 は 10 分後まで出ない）
    expect(nextStudyItem(result.session, reviewedAt)).toMatchObject({ kind: 'new', card: { id: 'c2' } })
    expect(nextStudyItem(result.session, local(6, 10, 11))).toMatchObject({
      kind: 'learning',
      card: { id: 'c1' },
    })
  })

  it('選んだ評価だけが保存される（preview した他の評価は保存されない）', async () => {
    const repos = setup()
    const { context, session } = await startStudySession(repos, 'm1', T)
    const preview = context.scheduler.preview(null, T)
    const card = session.cards['c1'] as Card
    await submitReview(repos, context, session, { card, rating: 'hard', reviewedAt: T, durationMs: null })

    const logs = await repos.reviews.listLogsForCard('m1', 'c1', { limit: 10 })
    expect(logs.map((log) => log.rating)).toEqual(['hard'])
    expect(logs[0]?.nextState.due).toEqual(preview.hard.due)
    expect((await repos.reviews.getProgress('m1')).ratingCounts).toEqual({ again: 0, hard: 1, good: 0, easy: 0 })
  })

  it('正式なレビュー日時は評価ボタンを押した時刻（preview の時刻ではない）', async () => {
    const repos = setup()
    const { context, session } = await startStudySession(repos, 'm1', T)
    const previewAt = T
    const pressedAt = local(6, 10, 5)
    context.scheduler.preview(null, previewAt)
    const card = session.cards['c1'] as Card
    const { record } = await submitReview(repos, context, session, {
      card,
      rating: 'good',
      reviewedAt: pressedAt,
      durationMs: null,
    })
    expect(record.log.reviewedAt).toEqual(pressedAt)
    expect(record.state.due).toEqual(local(6, 10, 15))
  })

  it('1 日の新規カード上限：同じ学習日の 2 回目のセッションでは残りの枚数だけ', async () => {
    const repos = setup({ newCardsPerDay: 3 })
    const { context, session: initial } = await startStudySession(repos, 'm1', T)
    let session = initial
    for (const id of ['c1', 'c2']) {
      const result = await submitReview(repos, context, session, {
        card: session.cards[id] as Card,
        rating: 'easy',
        reviewedAt: T,
        durationMs: null,
      })
      session = result.session
    }

    const sameDay = await startStudySession(repos, 'm1', local(6, 20))
    expect(sameDay.session.newCardIds).toEqual(['c3'])

    // 翌日の学習日（翌 4:00 以降）は再び 3 枚
    const nextDay = await startStudySession(repos, 'm1', local(7, 4, 1))
    expect(nextDay.session.newCardIds).toEqual(['c3', 'c4', 'c5'])
  })

  it('期限が来た復習カードを読み込み、新規より先に出す', async () => {
    const repos = setup({ newCardsPerDay: 1 })
    const { context, session } = await startStudySession(repos, 'm1', T)
    const result = await submitReview(repos, context, session, {
      card: session.cards['c1'] as Card,
      rating: 'easy',
      reviewedAt: T,
      durationMs: null,
    })
    const due = result.record.state.due
    expect(result.record.state.phase).toBe('review')

    // 期限の日の朝（時刻はまだ前でも、その学習日内なら出題する）
    const dueDay = new Date(due.getFullYear(), due.getMonth(), due.getDate(), 4, 30)
    const onDueDay = await startStudySession(repos, 'm1', dueDay)
    expect(nextStudyItem(onDueDay.session, dueDay)).toMatchObject({ kind: 'review', card: { id: 'c1' } })
    expect(onDueDay.session.newCardIds).toEqual(['c2'])

    // 前日の学習日にはまだ出ない
    const dayBefore = new Date(dueDay.getTime() - 24 * 3_600_000)
    const before = await startStudySession(repos, 'm1', dayBefore)
    expect(nextStudyItem(before.session, dayBefore)).toMatchObject({ kind: 'new', card: { id: 'c2' } })
  })

  it('アーカイブ済みのカードは新規に出さない', async () => {
    const repos = setup({
      cards: [makeCard({ id: 'a', order: 1, isArchived: true }), makeCard({ id: 'b', order: 2 })],
    })
    const { session } = await startStudySession(repos, 'm1', T)
    expect(session.newCardIds).toEqual(['b'])
  })

  it('集計のカーソルがずれていても、学習済みのカードを新規として出さない', async () => {
    const repos = setup({ newCardsPerDay: 2 })
    const { context, session } = await startStudySession(repos, 'm1', T)
    // c2 を先に学習（c1 は未学習のまま → カーソルは 2 まで進む）
    await submitReview(repos, context, session, {
      card: session.cards['c2'] as Card,
      rating: 'easy',
      reviewedAt: T,
      durationMs: null,
    })
    const next = await startStudySession(repos, 'm1', local(7, 10))
    expect(next.session.newCardIds).toEqual(['c3', 'c4'])
  })
})

describe('学習状態の欠落の検出と復元', () => {
  it('ReviewLog があるのに ReviewState がないカードは、新規として出さずにエラーにする', async () => {
    const repos = setup({ newCardsPerDay: 3 })
    const { context, session } = await startStudySession(repos, 'm1', T)
    await submitReview(repos, context, session, {
      card: session.cards['c1'] as Card,
      rating: 'good',
      reviewedAt: T,
      durationMs: null,
    })
    // 集計のカーソルが戻り、c1 の ReviewState だけが見つからない状態
    const progress = await repos.reviews.getProgress('m1')
    await repos.reviews.replaceProgress({ ...progress, newCursorOrder: 0 })
    const getStates = repos.reviews.getStates.bind(repos.reviews)
    repos.reviews.getStates = async (materialId, ids) =>
      (await getStates(materialId, ids)).filter((state) => state.cardId !== 'c1')

    const error = await startStudySession(repos, 'm1', local(6, 12)).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(CorruptedReviewStateError)
    expect((error as CorruptedReviewStateError).cardIds).toEqual(['c1'])
  })

  it('最新の有効な ReviewLog の nextState から復元する（ReviewLog と集計は変わらない）', async () => {
    const repos = setup({ newCardsPerDay: 1 })
    const { context, session } = await startStudySession(repos, 'm1', T)
    const first = await submitReview(repos, context, session, {
      card: session.cards['c1'] as Card,
      rating: 'good',
      reviewedAt: T,
      durationMs: null,
    })
    const second = await submitReview(repos, context, first.session, {
      card: session.cards['c1'] as Card,
      rating: 'good',
      reviewedAt: local(6, 10, 11),
      durationMs: null,
    })
    const progressBefore = await repos.reviews.getProgress('m1')

    const result = await restoreReviewStates(repos, 'm1', ['c1', 'c2'], local(6, 12))
    expect(result).toEqual({ restored: ['c1'], failed: ['c2'] })
    const [state] = await repos.reviews.getStates('m1', ['c1'])
    expect(toSchedulingSnapshot(state as ReviewState)).toEqual(second.record.log.nextState)
    expect(second.record.log.previousState).toEqual(first.record.log.nextState)
    expect(state).toMatchObject({ lastLogId: second.record.log.id, firstReviewedAt: T, ratingCounts: { good: 2 } })
    expect(await repos.reviews.listLogsForCard('m1', 'c1', { limit: 10 })).toHaveLength(2)
    expect(await repos.reviews.getProgress('m1')).toEqual(progressBefore)
  })
})

describe('loadStudyOverview（ホーム画面の件数）', () => {
  it('今日の復習・学習中で今出せる数・新規を区別して数える', async () => {
    const repos = setup({ newCardsPerDay: 3 })
    const before = await loadStudyOverview(repos, 'm1', T)
    expect(before.counts).toMatchObject({ reviewDueToday: 0, learningDueNow: 0, newAvailable: 3 })

    const { context, session } = await startStudySession(repos, 'm1', T)
    await submitReview(repos, context, session, {
      card: session.cards['c1'] as Card,
      rating: 'again',
      reviewedAt: T,
      durationMs: null,
    })

    const soon = await loadStudyOverview(repos, 'm1', T)
    expect(soon.counts).toMatchObject({ learningDueNow: 0, learningLater: 1, newAvailable: 2 })
    expect(soon.counts.nextLearningDueAt).toEqual(local(6, 10, 1))

    const later = await loadStudyOverview(repos, 'm1', local(6, 10, 1))
    expect(later.counts.learningDueNow).toBe(1)
  })

  it('存在しない教材はエラー', async () => {
    await expect(loadStudyOverview(setup(), 'none', T)).rejects.toMatchObject({ kind: 'not-found' })
  })
})
