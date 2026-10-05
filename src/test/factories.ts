import {
  emptyRatingCounts,
  type Card,
  type ReviewLog,
  type ReviewRating,
  type ReviewState,
  type SchedulerRef,
  type SchedulingSnapshot,
  type StudyMaterial,
} from '../domain'
import type { ReviewRecord } from '../repositories/types'

/** テスト用のデータを作る関数。必要な項目だけ上書きして使う。 */

export const T0 = new Date('2026-10-01T09:00:00+09:00')

export const hoursAfter = (base: Date, hours: number) => new Date(base.getTime() + hours * 3_600_000)

export function makeMaterial(overrides: Partial<StudyMaterial> = {}): StudyMaterial {
  return {
    id: 'm1',
    title: 'テスト教材',
    description: '',
    isActive: true,
    newCardsPerDay: 10,
    createdAt: T0,
    updatedAt: T0,
    ...overrides,
  }
}

export function makeCard(overrides: Partial<Card> & Pick<Card, 'id'>): Card {
  return {
    materialId: 'm1',
    question: `問題 ${overrides.id}`,
    answer: `答え ${overrides.id}`,
    explanation: '',
    category: 'カテゴリーA',
    tags: [],
    order: 1,
    isArchived: false,
    createdAt: T0,
    updatedAt: T0,
    ...overrides,
  }
}

export function makeSnapshot(overrides: Partial<SchedulingSnapshot> = {}): SchedulingSnapshot {
  return {
    phase: 'review',
    due: hoursAfter(T0, 24),
    stability: 3.2,
    difficulty: 5.1,
    scheduledDays: 1,
    learningSteps: 0,
    reps: 1,
    lapses: 0,
    lastReviewedAt: T0,
    ...overrides,
  }
}

export const TEST_SCHEDULER: SchedulerRef = {
  configId: 'ts-fsrs@0.0.0-test',
  library: 'ts-fsrs',
  libraryVersion: '0.0.0',
}

export function makeState(
  overrides: Partial<ReviewState> & Pick<ReviewState, 'cardId'>,
): ReviewState {
  return {
    ...makeSnapshot(),
    materialId: 'm1',
    suspended: false,
    firstReviewedAt: T0,
    ratingCounts: { ...emptyRatingCounts(), good: 1 },
    lastLogId: `log-${overrides.cardId}`,
    schedulerConfigId: TEST_SCHEDULER.configId,
    updatedAt: T0,
    ...overrides,
  }
}

/**
 * 1 回のレビュー結果（ReviewState・ReviewLog・集計用の情報）を、互いに整合した形で作る。
 * previous を省略すると初回レビュー（新規カード）になる。
 */
export function makeReviewRecord(params: {
  cardId: string
  logId: string
  rating?: ReviewRating
  reviewedAt?: Date
  previous?: SchedulingSnapshot | null
  next?: Partial<SchedulingSnapshot>
  materialId?: string
  category?: string
  cardOrder?: number
}): ReviewRecord {
  const materialId = params.materialId ?? 'm1'
  const reviewedAt = params.reviewedAt ?? T0
  const rating = params.rating ?? 'good'
  const nextState = makeSnapshot({ lastReviewedAt: reviewedAt, ...params.next })
  const log: ReviewLog = {
    id: params.logId,
    materialId,
    cardId: params.cardId,
    reviewedAt,
    rating,
    previousState: params.previous ?? null,
    nextState,
    scheduler: TEST_SCHEDULER,
    durationMs: 4200,
  }
  const state = makeState({
    ...nextState,
    cardId: params.cardId,
    materialId,
    lastLogId: params.logId,
    firstReviewedAt: reviewedAt,
    ratingCounts: { ...emptyRatingCounts(), [rating]: 1 },
    updatedAt: reviewedAt,
  })
  return {
    state,
    log,
    context: {
      category: params.category ?? 'カテゴリーA',
      cardOrder: params.cardOrder ?? 1,
      dayKey: '2026-10-01',
    },
  }
}
