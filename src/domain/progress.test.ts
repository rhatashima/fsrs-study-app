// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { hoursAfter, makeCard, makeSnapshot, makeState, T0 } from '../test/factories'
import { emptyRatingCounts } from './rating'
import {
  applyReview,
  DAILY_HISTORY_DAYS,
  emptyProgress,
  progressTotalReviews,
  rebuildProgress,
  remainingNewCardsToday,
  unstudiedCards,
  type MaterialProgress,
} from './progress'

const context = { category: '石垣', cardOrder: 3, dayKey: '2026-10-01' }

function withCards(totalCards: number): MaterialProgress {
  return { ...emptyProgress('m1', T0), totalCards }
}

describe('applyReview（レビューを集計に加える）', () => {
  it('初回レビューは学習済みカード数・新規数を増やし、カーソルを進める', () => {
    const next = applyReview(withCards(10), { rating: 'good', reviewedAt: T0, previousState: null }, context)
    expect(next.studiedCards).toBe(1)
    expect(unstudiedCards(next)).toBe(9)
    expect(next.newCursorOrder).toBe(3)
    expect(next.ratingCounts).toEqual({ ...emptyRatingCounts(), good: 1 })
    expect(next.byCategory['石垣']?.studiedCards).toBe(1)
    expect(next.daily['2026-10-01']).toEqual({ reviews: 1, newCards: 1 })
    expect(next.lastReviewedAt).toEqual(T0)
  })

  it('2 回目以降のレビューはレビュー数だけを増やす', () => {
    const first = applyReview(withCards(10), { rating: 'good', reviewedAt: T0, previousState: null }, context)
    const later = hoursAfter(T0, 1)
    const second = applyReview(
      first,
      { rating: 'again', reviewedAt: later, previousState: makeSnapshot() },
      { ...context, cardOrder: 1 },
    )
    expect(second.studiedCards).toBe(1)
    expect(second.newCursorOrder).toBe(3)
    expect(progressTotalReviews(second)).toBe(2)
    expect(second.ratingCounts.again).toBe(1)
    expect(second.daily['2026-10-01']).toEqual({ reviews: 2, newCards: 1 })
    expect(second.lastReviewedAt).toEqual(later)
  })

  it('元の集計オブジェクトを変更しない', () => {
    const before = withCards(10)
    const snapshot = structuredClone(before)
    applyReview(before, { rating: 'easy', reviewedAt: T0, previousState: null }, context)
    expect(before).toEqual(snapshot)
  })

  it(`日別記録は直近 ${DAILY_HISTORY_DAYS} 日分だけ残す`, () => {
    let progress = withCards(100)
    for (let day = 1; day <= DAILY_HISTORY_DAYS + 5; day++) {
      const dayKey = `2026-01-${String(day).padStart(2, '0')}`
      progress = applyReview(progress, { rating: 'good', reviewedAt: T0, previousState: makeSnapshot() }, {
        ...context,
        dayKey,
      })
    }
    const keys = Object.keys(progress.daily)
    expect(keys).toHaveLength(DAILY_HISTORY_DAYS)
    expect(keys).not.toContain('2026-01-01')
    expect(keys).toContain(`2026-01-${DAILY_HISTORY_DAYS + 5}`)
  })
})

describe('remainingNewCardsToday', () => {
  it('1 日の上限から今日導入した数を引く', () => {
    const progress = { ...withCards(50), daily: { '2026-10-01': { reviews: 7, newCards: 3 } } }
    expect(remainingNewCardsToday(progress, 10, '2026-10-01')).toBe(7)
    expect(remainingNewCardsToday(progress, 10, '2026-10-02')).toBe(10)
  })

  it('未学習カードの数を超えない・負にならない', () => {
    const progress = { ...withCards(5), studiedCards: 3, daily: { '2026-10-01': { reviews: 0, newCards: 12 } } }
    expect(remainingNewCardsToday(progress, 10, '2026-10-02')).toBe(2)
    expect(remainingNewCardsToday(progress, 10, '2026-10-01')).toBe(0)
  })
})

describe('rebuildProgress（全件からの再集計）', () => {
  const cards = [
    makeCard({ id: 'c1', order: 1, category: '石垣' }),
    makeCard({ id: 'c2', order: 2, category: '石垣' }),
    makeCard({ id: 'c3', order: 3, category: '天守' }),
    makeCard({ id: 'c4', order: 4, category: '' }),
    makeCard({ id: 'c5', order: 5, isArchived: true }),
    makeCard({ id: 'x1', order: 1, materialId: 'm2' }),
  ]
  const states = [
    makeState({ cardId: 'c1', ratingCounts: { again: 1, hard: 0, good: 2, easy: 0 } }),
    makeState({ cardId: 'c2', ratingCounts: { again: 0, hard: 1, good: 0, easy: 1 } }),
    makeState({ cardId: 'c4', ratingCounts: { again: 0, hard: 0, good: 1, easy: 0 } }),
  ]

  it('件数・評価回数・カテゴリー別を数え直す（アーカイブと他教材は除く）', () => {
    const progress = rebuildProgress({ materialId: 'm1', cards, states, now: T0 })
    expect(progress.totalCards).toBe(4)
    expect(progress.studiedCards).toBe(3)
    expect(progress.ratingCounts).toEqual({ again: 1, hard: 1, good: 3, easy: 1 })
    expect(progress.byCategory['石垣']).toMatchObject({ totalCards: 2, studiedCards: 2 })
    expect(progress.byCategory['天守']).toMatchObject({ totalCards: 1, studiedCards: 0 })
    expect(progress.byCategory['未分類']).toMatchObject({ totalCards: 1, studiedCards: 1 })
    expect(progress.rebuiltAt).toEqual(T0)
  })

  it('カーソルは先頭から連続して学習済みのカードまで（間の未学習カードを取りこぼさない）', () => {
    expect(rebuildProgress({ materialId: 'm1', cards, states, now: T0 }).newCursorOrder).toBe(2)
  })

  it('日別記録は以前の集計から引き継ぐ', () => {
    const previous = { ...withCards(0), daily: { '2026-09-30': { reviews: 4, newCards: 2 } } }
    const progress = rebuildProgress({ materialId: 'm1', cards, states, previous, now: T0 })
    expect(progress.daily).toEqual(previous.daily)
  })
})
