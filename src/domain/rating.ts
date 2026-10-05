/**
 * 利用者の自己評価。ts-fsrs の Rating（数値 enum）との変換は src/lib/fsrs/ で行う。
 */
export const REVIEW_RATINGS = ['again', 'hard', 'good', 'easy'] as const

export type ReviewRating = (typeof REVIEW_RATINGS)[number]

export type RatingCounts = Record<ReviewRating, number>

export function emptyRatingCounts(): RatingCounts {
  return { again: 0, hard: 0, good: 0, easy: 0 }
}

export function addRating(counts: RatingCounts, rating: ReviewRating): RatingCounts {
  return { ...counts, [rating]: counts[rating] + 1 }
}

export function totalReviews(counts: RatingCounts): number {
  return counts.again + counts.hard + counts.good + counts.easy
}

export function sumRatingCounts(a: RatingCounts, b: RatingCounts): RatingCounts {
  return {
    again: a.again + b.again,
    hard: a.hard + b.hard,
    good: a.good + b.good,
    easy: a.easy + b.easy,
  }
}
