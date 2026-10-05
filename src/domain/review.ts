import type { RatingCounts, ReviewRating } from './rating'
import type { SchedulerRef, SchedulingSnapshot } from './scheduling'

/**
 * カード 1 枚の現在の FSRS 状態（ドキュメント id = cardId）。Card とは別に保存し、
 * Card の編集・再インポートでは変更しない。
 * ReviewState が存在しないカード = 未学習（新規）カード。
 *
 * 不変条件：FSRS 部分（SchedulingSnapshot）は、lastLogId の ReviewLog の nextState と一致する。
 */
export interface ReviewState extends SchedulingSnapshot {
  cardId: string
  materialId: string
  /** カードのアーカイブ時に true。期限到来の対象から外す */
  suspended: boolean
  firstReviewedAt: Date
  /** このカードの評価回数（統計の再集計用） */
  ratingCounts: RatingCounts
  /** この状態を作った ReviewLog の id */
  lastLogId: string
  /** この状態を計算した FSRS 設定の id */
  schedulerConfigId: string
  updatedAt: Date
}

/**
 * 1 回のレビューの記録。追記のみで、作成後は変更・削除しない。
 * previousState / nextState の完全なスナップショットを持つため、
 * ReviewState が欠落・破損しても最新の ReviewLog から再計算なしで復元できる。
 */
export interface ReviewLog {
  readonly id: string
  readonly materialId: string
  readonly cardId: string
  readonly reviewedAt: Date
  readonly rating: ReviewRating
  /** レビュー直前の状態。初回レビュー（新規カード）では null */
  readonly previousState: Readonly<SchedulingSnapshot> | null
  /** レビュー後の状態 */
  readonly nextState: Readonly<SchedulingSnapshot>
  /** 計算に使った FSRS 設定とライブラリのバージョン */
  readonly scheduler: SchedulerRef
  /** 問題を表示してから評価するまでの時間（ミリ秒）。計測できない場合は null */
  readonly durationMs: number | null
}

export function isFirstReview(log: Pick<ReviewLog, 'previousState'>): boolean {
  return log.previousState === null
}

/** ReviewState がない = まだ一度も学習していない */
export function isUnstudied(state: ReviewState | undefined): state is undefined {
  return state === undefined
}

/** 復習期限が来ているか（一時停止中のカードは対象外） */
export function isDue(state: Pick<ReviewState, 'due' | 'suspended'>, now: Date): boolean {
  return !state.suspended && state.due.getTime() <= now.getTime()
}
