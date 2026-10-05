import type { ReviewRating } from '../domain'

/** 評価ボタンの表示名 */
export const RATING_LABELS: Record<ReviewRating, { label: string; sub: string }> = {
  again: { label: '忘れた', sub: 'Again' },
  hard: { label: '難しい', sub: 'Hard' },
  good: { label: '正解', sub: 'Good' },
  easy: { label: '簡単', sub: 'Easy' },
}
