import { REVIEW_RATINGS, type ReviewRating } from '../domain'
import styles from './RatingButtons.module.css'
import { RATING_LABELS } from './ratingLabels'

interface RatingButtonsProps {
  /** 各評価を選んだ場合の次回予定（表示用の文字列） */
  intervals: Record<ReviewRating, string>
  disabled: boolean
  onRate: (rating: ReviewRating) => void
}

export function RatingButtons({ intervals, disabled, onRate }: RatingButtonsProps) {
  return (
    <div className={styles.grid} role="group" aria-label="自己評価">
      {REVIEW_RATINGS.map((rating) => (
        <button
          key={rating}
          type="button"
          className={`${styles.button} ${styles[rating]}`}
          disabled={disabled}
          onClick={() => onRate(rating)}
          aria-label={`${RATING_LABELS[rating].label}（次回 ${intervals[rating]}後）`}
        >
          <span className={styles.interval}>{intervals[rating]}</span>
          <span className={styles.label}>{RATING_LABELS[rating].label}</span>
          <span className={styles.sub}>{RATING_LABELS[rating].sub}</span>
        </button>
      ))}
    </div>
  )
}
