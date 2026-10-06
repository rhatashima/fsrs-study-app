import { addRating, emptyRatingCounts, type RatingCounts, type ReviewRating } from './rating'
import { snapshotsEqual, toSchedulingSnapshot, type SchedulerRef, type SchedulingSnapshot } from './scheduling'

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

/**
 * 同じレビューの記録か（通信の再試行などで同じ id の ReviewLog を再送した場合の判定）。
 * id・カード・評価・日時・結果の状態が同じなら同じレビューとみなす。
 */
export function sameReviewLog(a: ReviewLog, b: ReviewLog): boolean {
  return (
    a.id === b.id &&
    a.materialId === b.materialId &&
    a.cardId === b.cardId &&
    a.rating === b.rating &&
    a.reviewedAt.getTime() === b.reviewedAt.getTime() &&
    snapshotsEqual(a.nextState, b.nextState)
  )
}

/** 保存されている状態が、このレビューの直前の状態（previousState）と一致するか */
export function matchesPreviousState(stored: ReviewState | null, log: Pick<ReviewLog, 'previousState'>): boolean {
  if (stored === null || log.previousState === null) return stored === null && log.previousState === null
  return snapshotsEqual(stored, log.previousState)
}

/**
 * 学習履歴（ReviewLog）から ReviewState を復元する。再計算はしない：
 * 最新のレビューの nextState をそのまま使い、評価回数と初回日時は履歴から数え直す。
 * 履歴がなければ null。
 */
export function restoreStateFromLogs(
  logs: readonly ReviewLog[],
  options: { suspended: boolean; now: Date },
): ReviewState | null {
  if (logs.length === 0) return null
  const sorted = [...logs].sort(
    (a, b) => a.reviewedAt.getTime() - b.reviewedAt.getTime() || a.id.localeCompare(b.id),
  )
  const first = sorted[0] as ReviewLog
  const latest = sorted[sorted.length - 1] as ReviewLog
  const ratingCounts = sorted.reduce((counts, log) => addRating(counts, log.rating), emptyRatingCounts())
  return {
    ...toSchedulingSnapshot(latest.nextState),
    cardId: latest.cardId,
    materialId: latest.materialId,
    suspended: options.suspended,
    firstReviewedAt: first.reviewedAt,
    ratingCounts,
    lastLogId: latest.id,
    schedulerConfigId: latest.scheduler.configId,
    updatedAt: options.now,
  }
}

/** 復習期限が来ているか（一時停止中のカードは対象外） */
export function isDue(state: Pick<ReviewState, 'due' | 'suspended'>, now: Date): boolean {
  return !state.suspended && state.due.getTime() <= now.getTime()
}
