// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { makeCard, makeState } from '../test/factories'
import { studyDayEnd } from './date'
import {
  applyAnswer,
  classifyStates,
  createStudySession,
  isAvailableNow,
  nextStudyItem,
  sessionCounts,
} from './studyQueue'

// 端末のローカル時刻（学習日の区切りは 4:00）
const local = (d: number, h: number, min = 0) => new Date(2026, 9, d, h, min)
const NOW = local(6, 10, 0) // 2026-10-06 10:00
const DAY_END = studyDayEnd(NOW, 4) // 2026-10-07 04:00

describe('isAvailableNow（出題できるか）', () => {
  it('Learning / Relearning は due 前には出ない', () => {
    expect(isAvailableNow(makeState({ cardId: 'c', phase: 'learning', due: local(6, 10, 10) }), NOW, DAY_END)).toBe(false)
    expect(isAvailableNow(makeState({ cardId: 'c', phase: 'relearning', due: local(6, 10, 1) }), NOW, DAY_END)).toBe(false)
  })

  it('Learning / Relearning は due 時刻ちょうど・以降に出る', () => {
    expect(isAvailableNow(makeState({ cardId: 'c', phase: 'learning', due: NOW }), NOW, DAY_END)).toBe(true)
    expect(isAvailableNow(makeState({ cardId: 'c', phase: 'relearning', due: local(6, 9) }), NOW, DAY_END)).toBe(true)
  })

  it('Review は今日の学習日内（翌 4:00 より前）なら、時刻前でも出る', () => {
    expect(isAvailableNow(makeState({ cardId: 'c', phase: 'review', due: local(6, 23, 0) }), NOW, DAY_END)).toBe(true)
    expect(isAvailableNow(makeState({ cardId: 'c', phase: 'review', due: local(7, 3, 59) }), NOW, DAY_END)).toBe(true)
  })

  it('明日以降（翌 4:00 以降）の Review は出ない', () => {
    expect(isAvailableNow(makeState({ cardId: 'c', phase: 'review', due: local(7, 4, 0) }), NOW, DAY_END)).toBe(false)
    expect(isAvailableNow(makeState({ cardId: 'c', phase: 'review', due: local(8, 10) }), NOW, DAY_END)).toBe(false)
  })

  it('深夜 3:00 は前日の学習日：当日 4:00 以降が期限の Review は出ない', () => {
    const lateNight = local(7, 3, 0)
    const dayEnd = studyDayEnd(lateNight, 4) // 2026-10-07 04:00
    expect(isAvailableNow(makeState({ cardId: 'c', phase: 'review', due: local(7, 3, 30) }), lateNight, dayEnd)).toBe(true)
    expect(isAvailableNow(makeState({ cardId: 'c', phase: 'review', due: local(7, 9, 0) }), lateNight, dayEnd)).toBe(false)
  })

  it('一時停止中は出ない', () => {
    expect(
      isAvailableNow(makeState({ cardId: 'c', phase: 'review', due: local(5, 10), suspended: true }), NOW, DAY_END),
    ).toBe(false)
  })
})

describe('classifyStates', () => {
  it('学習中（今出せる / まだ）と今日の復習に分け、それぞれ due の早い順に並べる', () => {
    const result = classifyStates(
      [
        makeState({ cardId: 'r2', phase: 'review', due: local(6, 20) }),
        makeState({ cardId: 'r1', phase: 'review', due: local(5, 8) }),
        makeState({ cardId: 'tomorrow', phase: 'review', due: local(7, 9) }),
        makeState({ cardId: 'l2', phase: 'relearning', due: local(6, 9, 59) }),
        makeState({ cardId: 'l1', phase: 'learning', due: local(6, 9, 0) }),
        makeState({ cardId: 'later', phase: 'learning', due: local(6, 10, 10) }),
      ],
      NOW,
      DAY_END,
    )
    const ids = (list: { cardId: string }[]) => list.map((s) => s.cardId)
    expect(ids(result.learningDueNow)).toEqual(['l1', 'l2'])
    expect(ids(result.reviewDueToday)).toEqual(['r1', 'r2'])
    expect(ids(result.learningLater)).toEqual(['later'])
  })
})

describe('学習セッション', () => {
  const cards = [
    makeCard({ id: 'review-late', order: 1 }),
    makeCard({ id: 'review-early', order: 2 }),
    makeCard({ id: 'learning', order: 3 }),
    makeCard({ id: 'new-b', order: 20 }),
    makeCard({ id: 'new-a', order: 10 }),
  ]
  const dueStates = [
    makeState({ cardId: 'review-late', phase: 'review', due: local(6, 18) }),
    makeState({ cardId: 'review-early', phase: 'review', due: local(5, 18) }),
    makeState({ cardId: 'learning', phase: 'learning', due: local(6, 10, 5) }),
  ]
  const session = createStudySession({
    materialId: 'm1',
    dayEnd: DAY_END,
    dueStates,
    dueCards: cards.slice(0, 3),
    newCards: cards.slice(3),
  })

  it('優先順位：今出せる学習中 → 今日の復習（due の古い順）→ 新規（order 順）', () => {
    const order: string[] = []
    let current = session
    const at = local(6, 10, 30) // 学習中カードの due（10:05）を過ぎている
    for (;;) {
      const next = nextStudyItem(current, at)
      if (next.kind === 'done') break
      order.push(`${next.kind}:${next.card.id}`)
      // 答えたことにして、明日以降の復習にする
      current = applyAnswer(current, makeState({ cardId: next.card.id, phase: 'review', due: local(9, 10) }), 'good')
    }
    expect(order).toEqual([
      'learning:learning',
      'review:review-early',
      'review:review-late',
      'new:new-a',
      'new:new-b',
    ])
  })

  it('Review が New より優先される（学習中カードがまだ due 前のとき）', () => {
    expect(nextStudyItem(session, NOW)).toMatchObject({ kind: 'review', card: { id: 'review-early' } })
  })

  it('学習中カードは due 前には出ず、due 後に再びキューに入る', () => {
    let current = session
    for (const id of ['review-early', 'review-late', 'new-a', 'new-b']) {
      current = applyAnswer(current, makeState({ cardId: id, phase: 'review', due: local(9, 10) }), 'good')
    }
    expect(nextStudyItem(current, NOW)).toEqual({ kind: 'done', nextLearningDueAt: local(6, 10, 5) })
    expect(nextStudyItem(current, local(6, 10, 5))).toMatchObject({ kind: 'learning', card: { id: 'learning' } })
  })

  it('回答で Again になったカードは、1 分後の due まで出題されない', () => {
    const answered = applyAnswer(
      session,
      makeState({ cardId: 'review-early', phase: 'relearning', due: local(6, 10, 1) }),
      'again',
    )
    expect(nextStudyItem(answered, NOW)).toMatchObject({ card: { id: 'review-late' } })
    expect(nextStudyItem(answered, local(6, 10, 1))).toMatchObject({ kind: 'learning', card: { id: 'review-early' } })
    expect(answered.answered.again).toBe(1)
  })

  it('件数：今日の復習・学習中で今出せる数・新規を区別する', () => {
    expect(sessionCounts(session, NOW)).toEqual({
      reviewDueToday: 2,
      learningDueNow: 0,
      newAvailable: 2,
      learningLater: 1,
      nextLearningDueAt: local(6, 10, 5),
    })
    expect(sessionCounts(session, local(6, 10, 5)).learningDueNow).toBe(1)
  })

  it('新規カードを回答すると新規の残りから外れ、学習中になる', () => {
    const answered = applyAnswer(session, makeState({ cardId: 'new-a', phase: 'learning', due: local(6, 10, 10) }), 'good')
    expect(answered.newCardIds).toEqual(['new-b'])
    expect(session.newCardIds).toEqual(['new-a', 'new-b'])
  })

  it('アーカイブ済みのカードと、内容がない ReviewState は出題しない', () => {
    const s = createStudySession({
      materialId: 'm1',
      dayEnd: DAY_END,
      dueStates: [
        makeState({ cardId: 'archived', phase: 'review', due: local(5, 10) }),
        makeState({ cardId: 'missing', phase: 'review', due: local(5, 10) }),
      ],
      dueCards: [makeCard({ id: 'archived', isArchived: true })],
      newCards: [makeCard({ id: 'archived-new', order: 5, isArchived: true })],
    })
    expect(nextStudyItem(s, NOW)).toEqual({ kind: 'done', nextLearningDueAt: null })
  })
})
