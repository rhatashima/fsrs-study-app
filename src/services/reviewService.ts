import {
  addRating,
  emptyRatingCounts,
  toDayKey,
  toSchedulerRef,
  toSchedulingSnapshot,
  type Card,
  type ReviewLog,
  type ReviewRating,
  type ReviewState,
} from '../domain'
import type { FsrsScheduler } from '../lib/fsrs'
import type { ReviewRecord } from '../repositories/types'

export interface ReviewCardInput {
  scheduler: FsrsScheduler
  card: Card
  /** 現在の状態。未学習（新規）カードなら null */
  current: ReviewState | null
  rating: ReviewRating
  /** 正式なレビュー日時（評価ボタンを押した時刻） */
  reviewedAt: Date
  logId: string
  durationMs: number | null
  dayStartHour: number
}

/**
 * 1 回のレビュー結果（ReviewState・ReviewLog・集計用の情報）を作る。保存はしない。
 * 次の状態の計算は FSRS スケジューラー（ts-fsrs）に任せ、ここでは結果をドメイン型に組み立てるだけ。
 */
export function reviewCard(input: ReviewCardInput): ReviewRecord {
  const { scheduler, card, current, rating, reviewedAt, logId } = input
  const previousState = current ? toSchedulingSnapshot(current) : null
  const nextState = scheduler.apply(previousState, rating, reviewedAt)

  const log: ReviewLog = {
    id: logId,
    materialId: card.materialId,
    cardId: card.id,
    reviewedAt,
    rating,
    previousState,
    nextState,
    scheduler: toSchedulerRef(scheduler.config),
    durationMs: input.durationMs,
  }

  const state: ReviewState = {
    ...toSchedulingSnapshot(nextState),
    cardId: card.id,
    materialId: card.materialId,
    suspended: current?.suspended ?? false,
    firstReviewedAt: current?.firstReviewedAt ?? reviewedAt,
    ratingCounts: addRating(current?.ratingCounts ?? emptyRatingCounts(), rating),
    lastLogId: logId,
    schedulerConfigId: scheduler.config.id,
    updatedAt: reviewedAt,
  }

  return {
    state,
    log,
    context: {
      category: card.category,
      cardOrder: card.order,
      dayKey: toDayKey(reviewedAt, input.dayStartHour),
    },
  }
}
