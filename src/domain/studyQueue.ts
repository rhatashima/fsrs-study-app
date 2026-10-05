import type { Card } from './card'
import { addRating, emptyRatingCounts, totalReviews, type RatingCounts, type ReviewRating } from './rating'
import type { ReviewState } from './review'
import type { LearningPhase } from './scheduling'

/*
 * 学習キューのルール（docs/ARCHITECTURE.md「学習キュー」）
 * 1. Learning / Relearning（短期の学習ステップ中）：due <= now になったものだけ出題する
 * 2. Review：due が現在の学習日の終わりより前なら、時刻を待たずに出題する（1 日の上限なし）
 * 3. New：今日の新規上限（StudyMaterial.newCardsPerDay − 今日導入済み）まで order 順に出題する
 * 優先順位は 1 → 2 → 3。同じ種類の中では Learning / Review は due の早い順、New は order 順。
 * 次のカードを選ぶたびに now を評価し直すので、学習中に due になった Learning カードも自然に戻ってくる。
 */

export type QueueKind = 'learning' | 'review' | 'new'

/** 短期の学習ステップ中（時刻で due を判定する）か */
export function isShortTermPhase(phase: LearningPhase): boolean {
  return phase === 'learning' || phase === 'relearning'
}

/** 今すぐ出題できるか（短期学習中は due <= now、それ以外は学習日の終わりより前） */
export function isAvailableNow(
  state: Pick<ReviewState, 'phase' | 'due' | 'suspended'>,
  now: Date,
  dayEnd: Date,
): boolean {
  if (state.suspended) return false
  return isShortTermPhase(state.phase)
    ? state.due.getTime() <= now.getTime()
    : state.due.getTime() < dayEnd.getTime()
}

const byDue = (a: ReviewState, b: ReviewState) =>
  a.due.getTime() - b.due.getTime() || a.cardId.localeCompare(b.cardId)

export interface ClassifiedStates {
  /** 学習中で、今出題できる */
  learningDueNow: ReviewState[]
  /** 学習中で、まだ時刻が来ていない */
  learningLater: ReviewState[]
  /** 今日の復習 */
  reviewDueToday: ReviewState[]
}

export function classifyStates(states: readonly ReviewState[], now: Date, dayEnd: Date): ClassifiedStates {
  const result: ClassifiedStates = { learningDueNow: [], learningLater: [], reviewDueToday: [] }
  for (const state of states) {
    if (state.suspended) continue
    if (isShortTermPhase(state.phase)) {
      ;(isAvailableNow(state, now, dayEnd) ? result.learningDueNow : result.learningLater).push(state)
    } else if (isAvailableNow(state, now, dayEnd)) {
      result.reviewDueToday.push(state)
    }
  }
  result.learningDueNow.sort(byDue)
  result.learningLater.sort(byDue)
  result.reviewDueToday.sort(byDue)
  return result
}

export interface StudyCounts {
  /** 今日の復習（Review） */
  reviewDueToday: number
  /** 学習中で今出題できる（Learning / Relearning） */
  learningDueNow: number
  /** 今日まだ導入できる新規カード */
  newAvailable: number
  /** 学習中でまだ時刻が来ていないカード */
  learningLater: number
  /** 学習中のカードが次に出題できるようになる日時 */
  nextLearningDueAt: Date | null
}

export function countStudyItems(
  states: readonly ReviewState[],
  newAvailable: number,
  now: Date,
  dayEnd: Date,
): StudyCounts {
  const classified = classifyStates(states, now, dayEnd)
  return {
    reviewDueToday: classified.reviewDueToday.length,
    learningDueNow: classified.learningDueNow.length,
    newAvailable,
    learningLater: classified.learningLater.length,
    nextLearningDueAt: classified.learningLater[0]?.due ?? null,
  }
}

/** 1 回の学習セッションの状態（セッション中にメモリ上で更新する） */
export interface StudySession {
  materialId: string
  /** 開始時点の学習日の終わり */
  dayEnd: Date
  /** 出題するカードの内容（期限到来分と今日の新規分） */
  cards: Record<string, Card>
  /** 出題対象カードの現在の ReviewState */
  states: Record<string, ReviewState>
  /** まだ出題していない新規カード（order 順） */
  newCardIds: string[]
  /** このセッションで答えた評価の回数 */
  answered: RatingCounts
}

export function createStudySession(params: {
  materialId: string
  dayEnd: Date
  dueStates: readonly ReviewState[]
  dueCards: readonly Card[]
  newCards: readonly Card[]
}): StudySession {
  const cards: Record<string, Card> = {}
  for (const card of [...params.dueCards, ...params.newCards]) {
    if (!card.isArchived) cards[card.id] = card
  }
  const states: Record<string, ReviewState> = {}
  for (const state of params.dueStates) {
    // カードの内容がない（アーカイブ済みなど）ものは出題しない
    if (cards[state.cardId]) states[state.cardId] = state
  }
  return {
    materialId: params.materialId,
    dayEnd: params.dayEnd,
    cards,
    states,
    newCardIds: [...params.newCards]
      .filter((card) => cards[card.id] && !states[card.id])
      .sort((a, b) => a.order - b.order)
      .map((card) => card.id),
    answered: emptyRatingCounts(),
  }
}

export type NextStudyItem =
  | { kind: QueueKind; card: Card; state: ReviewState | null }
  | { kind: 'done'; nextLearningDueAt: Date | null }

/** 次に出題するカード（なければ done） */
export function nextStudyItem(session: StudySession, now: Date): NextStudyItem {
  const classified = classifyStates(Object.values(session.states), now, session.dayEnd)
  const learning = classified.learningDueNow[0]
  if (learning) {
    return { kind: 'learning', card: session.cards[learning.cardId] as Card, state: learning }
  }
  const review = classified.reviewDueToday[0]
  if (review) {
    return { kind: 'review', card: session.cards[review.cardId] as Card, state: review }
  }
  const newCardId = session.newCardIds[0]
  if (newCardId) {
    return { kind: 'new', card: session.cards[newCardId] as Card, state: null }
  }
  return { kind: 'done', nextLearningDueAt: classified.learningLater[0]?.due ?? null }
}

export function sessionCounts(session: StudySession, now: Date): StudyCounts {
  return countStudyItems(Object.values(session.states), session.newCardIds.length, now, session.dayEnd)
}

/** 回答を反映したセッションを返す（元のセッションは変更しない） */
export function applyAnswer(session: StudySession, state: ReviewState, rating: ReviewRating): StudySession {
  return {
    ...session,
    states: { ...session.states, [state.cardId]: state },
    newCardIds: session.newCardIds.filter((id) => id !== state.cardId),
    answered: addRating(session.answered, rating),
  }
}

export function answeredCount(session: Pick<StudySession, 'answered'>): number {
  return totalReviews(session.answered)
}
