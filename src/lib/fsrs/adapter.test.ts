// @vitest-environment node
import { createEmptyCard, fsrs, Rating, State } from 'ts-fsrs'
import { describe, expect, it } from 'vitest'
import { LEARNING_PHASES, REVIEW_RATINGS, type SchedulingSnapshot } from '../../domain'
import {
  fromFsrsCard,
  fromFsrsRating,
  fromFsrsState,
  toFsrsCard,
  toFsrsRating,
  toFsrsState,
} from './adapter'

const T = new Date('2026-10-05T10:00:00+09:00')

describe('ReviewRating ↔ ts-fsrs Rating', () => {
  it.each([
    ['again', Rating.Again],
    ['hard', Rating.Hard],
    ['good', Rating.Good],
    ['easy', Rating.Easy],
  ] as const)('%s ↔ Rating %s', (rating, fsrsRating) => {
    expect(toFsrsRating(rating)).toBe(fsrsRating)
    expect(fromFsrsRating(fsrsRating)).toBe(rating)
  })

  it('4 評価すべてが往復で元に戻る', () => {
    for (const rating of REVIEW_RATINGS) expect(fromFsrsRating(toFsrsRating(rating))).toBe(rating)
  })
})

describe('LearningPhase ↔ ts-fsrs State', () => {
  it.each([
    ['new', State.New],
    ['learning', State.Learning],
    ['review', State.Review],
    ['relearning', State.Relearning],
  ] as const)('%s ↔ State %s', (phase, state) => {
    expect(toFsrsState(phase)).toBe(state)
    expect(fromFsrsState(state)).toBe(phase)
  })
})

describe('SchedulingSnapshot ↔ ts-fsrs Card', () => {
  it('新規カード（createEmptyCard）を変換できる', () => {
    const snapshot = fromFsrsCard(createEmptyCard(T))
    expect(snapshot).toEqual({
      phase: 'new',
      due: T,
      stability: 0,
      difficulty: 0,
      scheduledDays: 0,
      learningSteps: 0,
      reps: 0,
      lapses: 0,
      lastReviewedAt: null,
    })
  })

  it.each(LEARNING_PHASES)('%s 状態のカードが往復で元に戻る', (phase) => {
    const snapshot: SchedulingSnapshot = {
      phase,
      due: new Date('2026-10-08T12:34:56.789+09:00'),
      stability: 12.3456,
      difficulty: 6.789,
      scheduledDays: phase === 'review' ? 3 : 0,
      learningSteps: phase === 'learning' ? 1 : 0,
      reps: 4,
      lapses: phase === 'relearning' ? 1 : 0,
      lastReviewedAt: phase === 'new' ? null : new Date('2026-10-05T12:00:00.123+09:00'),
    }
    expect(fromFsrsCard(toFsrsCard(snapshot))).toEqual(snapshot)
  })

  it('日時はミリ秒まで保たれ、元のオブジェクトとは共有しない', () => {
    const due = new Date('2026-10-08T12:34:56.789+09:00')
    const lastReviewedAt = new Date('2026-10-05T01:02:03.004+09:00')
    const card = toFsrsCard({
      phase: 'review',
      due,
      stability: 1,
      difficulty: 5,
      scheduledDays: 3,
      learningSteps: 0,
      reps: 2,
      lapses: 0,
      lastReviewedAt,
    })
    expect(card.due.getTime()).toBe(due.getTime())
    expect(card.last_review?.getTime()).toBe(lastReviewedAt.getTime())
    card.due.setFullYear(2000)
    expect(due.getFullYear()).toBe(2026)
  })

  it('elapsed_days（v6 で削除予定）は渡した値に関係なく ts-fsrs が計算し直す', () => {
    const scheduler = fsrs({ enable_fuzz: false })
    let card = scheduler.next(createEmptyCard(T), T, Rating.Good).card
    card = scheduler.next(card, new Date(card.due), Rating.Good).card
    const now = new Date(card.due.getTime() + 3 * 86_400_000)
    const viaAdapter = scheduler.repeat(toFsrsCard(fromFsrsCard(card)), now)
    const original = scheduler.repeat({ ...card, elapsed_days: 999 }, now)
    for (const grade of [Rating.Again, Rating.Hard, Rating.Good, Rating.Easy] as const) {
      expect(viaAdapter[grade].card.due).toEqual(original[grade].card.due)
      expect(viaAdapter[grade].card.stability).toBe(original[grade].card.stability)
    }
  })
})
