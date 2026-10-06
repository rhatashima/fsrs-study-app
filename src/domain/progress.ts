import { categoryLabel, type Card } from './card'
import type { DayKey } from './date'
import {
  addRating,
  emptyRatingCounts,
  sumRatingCounts,
  totalReviews,
  type RatingCounts,
} from './rating'
import { isFirstReview, type ReviewLog, type ReviewState } from './review'

/** 直近何日分の日別記録を残すか */
export const DAILY_HISTORY_DAYS = 30

export interface CategoryProgress {
  totalCards: number
  studiedCards: number
  ratingCounts: RatingCounts
}

export interface DailyProgress {
  reviews: number
  newCards: number
}

/**
 * 教材ごとの学習の集計。ホーム・統計はこれ 1 件で表示し、ReviewLog を毎回読まない。
 * レビューのたびに applyReview で加算する（Firestore ではトランザクション内で読み取った集計にこの関数を適用して書く）。
 */
export interface MaterialProgress {
  materialId: string
  /** アーカイブされていないカード数 */
  totalCards: number
  /** 1 回以上学習したカード数（アーカイブ除く） */
  studiedCards: number
  /** order がこの値以下のカードは新規導入を検討済み */
  newCursorOrder: number
  ratingCounts: RatingCounts
  byCategory: Record<string, CategoryProgress>
  /** 直近 DAILY_HISTORY_DAYS 日分 */
  daily: Record<DayKey, DailyProgress>
  lastReviewedAt: Date | null
  /** 最後に全件から作り直した日時 */
  rebuiltAt: Date | null
  updatedAt: Date
}

export function emptyProgress(materialId: string, now: Date): MaterialProgress {
  return {
    materialId,
    totalCards: 0,
    studiedCards: 0,
    newCursorOrder: 0,
    ratingCounts: emptyRatingCounts(),
    byCategory: {},
    daily: {},
    lastReviewedAt: null,
    rebuiltAt: null,
    updatedAt: now,
  }
}

export function unstudiedCards(progress: Pick<MaterialProgress, 'totalCards' | 'studiedCards'>): number {
  return Math.max(0, progress.totalCards - progress.studiedCards)
}

export function progressTotalReviews(progress: Pick<MaterialProgress, 'ratingCounts'>): number {
  return totalReviews(progress.ratingCounts)
}

/** 今日あと何枚の新規カードを導入できるか */
export function remainingNewCardsToday(
  progress: Pick<MaterialProgress, 'daily' | 'totalCards' | 'studiedCards'>,
  newCardsPerDay: number,
  today: DayKey,
): number {
  const introducedToday = progress.daily[today]?.newCards ?? 0
  return Math.max(0, Math.min(newCardsPerDay - introducedToday, unstudiedCards(progress)))
}

/** レビュー時に、ReviewLog だけでは分からない集計用の情報 */
export interface ReviewProgressContext {
  /** レビュー時点のカードのカテゴリー */
  category: string
  /** レビュー時点のカードの order */
  cardOrder: number
  /** レビュー日時が属する学習日 */
  dayKey: DayKey
}

function emptyCategory(): CategoryProgress {
  return { totalCards: 0, studiedCards: 0, ratingCounts: emptyRatingCounts() }
}

function keepRecentDays(daily: Record<DayKey, DailyProgress>): Record<DayKey, DailyProgress> {
  const keys = Object.keys(daily).sort().slice(-DAILY_HISTORY_DAYS)
  return Object.fromEntries(keys.map((key) => [key, daily[key] as DailyProgress]))
}

/** 1 回のレビューを集計に加える（元のオブジェクトは変更しない） */
export function applyReview(
  progress: MaterialProgress,
  log: Pick<ReviewLog, 'rating' | 'reviewedAt' | 'previousState'>,
  context: ReviewProgressContext,
): MaterialProgress {
  const first = isFirstReview(log)
  const category = categoryLabel({ category: context.category })
  const current = progress.byCategory[category] ?? emptyCategory()
  const day = progress.daily[context.dayKey] ?? { reviews: 0, newCards: 0 }
  const lastReviewedAt =
    progress.lastReviewedAt && progress.lastReviewedAt > log.reviewedAt
      ? progress.lastReviewedAt
      : log.reviewedAt

  return {
    ...progress,
    studiedCards: progress.studiedCards + (first ? 1 : 0),
    newCursorOrder: first ? Math.max(progress.newCursorOrder, context.cardOrder) : progress.newCursorOrder,
    ratingCounts: addRating(progress.ratingCounts, log.rating),
    byCategory: {
      ...progress.byCategory,
      [category]: {
        totalCards: current.totalCards,
        studiedCards: current.studiedCards + (first ? 1 : 0),
        ratingCounts: addRating(current.ratingCounts, log.rating),
      },
    },
    daily: keepRecentDays({
      ...progress.daily,
      [context.dayKey]: { reviews: day.reviews + 1, newCards: day.newCards + (first ? 1 : 0) },
    }),
    lastReviewedAt,
    updatedAt: log.reviewedAt,
  }
}

/**
 * Card と ReviewState の全件から集計を作り直す（利用者が明示的に実行する「再集計」と、開発用データの初期化に使う）。
 * 日別記録と最終学習日時は ReviewState からは分からないため、previous から引き継ぐ。
 */
export function rebuildProgress(params: {
  materialId: string
  cards: readonly Card[]
  states: readonly ReviewState[]
  previous?: MaterialProgress
  now: Date
}): MaterialProgress {
  const { materialId, now, previous } = params
  const activeCards = params.cards
    .filter((card) => card.materialId === materialId && !card.isArchived)
    .sort((a, b) => a.order - b.order)
  const statesById = new Map(
    params.states.filter((s) => s.materialId === materialId).map((s) => [s.cardId, s]),
  )

  let ratingCounts = emptyRatingCounts()
  let studiedCards = 0
  const byCategory: Record<string, CategoryProgress> = {}
  // 先頭から連続して学習済みのカードまでカーソルを進める
  let newCursorOrder = 0
  let prefixStudied = true

  for (const card of activeCards) {
    const category = categoryLabel(card)
    const entry = (byCategory[category] ??= emptyCategory())
    entry.totalCards += 1
    const state = statesById.get(card.id)
    if (state) {
      studiedCards += 1
      entry.studiedCards += 1
      entry.ratingCounts = sumRatingCounts(entry.ratingCounts, state.ratingCounts)
      ratingCounts = sumRatingCounts(ratingCounts, state.ratingCounts)
      if (prefixStudied) newCursorOrder = card.order
    } else {
      prefixStudied = false
    }
  }

  return {
    materialId,
    totalCards: activeCards.length,
    studiedCards,
    newCursorOrder,
    ratingCounts,
    byCategory,
    daily: previous ? keepRecentDays(previous.daily) : {},
    lastReviewedAt: previous?.lastReviewedAt ?? null,
    rebuiltAt: now,
    updatedAt: now,
  }
}
