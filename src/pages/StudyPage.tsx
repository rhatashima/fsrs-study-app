import { useEffect } from 'react'
import { Link } from 'react-router'
import { RatingButtons } from '../components/RatingButtons'
import { RATING_LABELS } from '../components/ratingLabels'
import { StudyCard } from '../components/StudyCard'
import { REVIEW_RATINGS, type ReviewRating } from '../domain'
import { useStudySession, type StudyView } from '../hooks/useStudySession'
import { formatInterval } from '../lib/formatInterval'
import styles from './Page.module.css'
import studyStyles from './StudyPage.module.css'

const KIND_LABELS = { learning: '学習中', review: '復習', new: '新規' } as const

export function StudyPage() {
  const { view, reveal, answer, retrySave, restore, refreshPreviewIfStale, checkAgain } = useStudySession()

  // 保存中・保存に失敗したレビューがあるときにページを閉じようとしたら、ブラウザの確認を出す
  const unsaved = view.status === 'studying' && (view.saving || view.canRetrySave)
  useEffect(() => {
    if (!unsaved) return
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault()
    }
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => window.removeEventListener('beforeunload', onBeforeUnload)
  }, [unsaved])

  // 別のアプリから戻ってきたとき、古くなった次回予定を計算し直す
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === 'visible') refreshPreviewIfStale()
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
  }, [refreshPreviewIfStale])

  return (
    <section className={styles.page}>
      <h1 className={styles.title}>学習</h1>
      {view.status === 'loading' && <p className={styles.muted}>読み込み中…</p>}
      {view.status === 'error' && <p role="alert">{view.message}</p>}
      {view.status === 'no-material' && (
        <div className={styles.panel}>
          <p className={styles.muted}>学習できる教材がありません。</p>
        </div>
      )}
      {view.status === 'corrupted' && <Corrupted view={view} onRestore={() => void restore()} />}
      {view.status === 'studying' && (
        <Studying
          view={view}
          onReveal={reveal}
          onRate={(rating) => void answer(rating)}
          onRetrySave={() => void retrySave()}
        />
      )}
      {view.status === 'done' && <Done view={view} onCheckAgain={checkAgain} />}
    </section>
  )
}

function Corrupted({ view, onRestore }: { view: Extract<StudyView, { status: 'corrupted' }>; onRestore: () => void }) {
  return (
    <div className={styles.panel}>
      <p role="alert">{view.message}</p>
      <p className={styles.muted}>
        学習履歴の最新の記録から、学習状態を元に戻します。学習履歴そのものは変更しません。
      </p>
      {view.restoreError && <p role="alert">{view.restoreError}</p>}
      <button type="button" className={styles.primaryButton} onClick={onRestore} disabled={view.restoring}>
        {view.restoring ? '復元中…' : '学習履歴から復元する'}
      </button>
    </div>
  )
}

function Studying({
  view,
  onReveal,
  onRate,
  onRetrySave,
}: {
  view: Extract<StudyView, { status: 'studying' }>
  onReveal: () => void
  onRate: (rating: ReviewRating) => void
  onRetrySave: () => void
}) {
  const { item, counts, preview } = view
  const intervals = preview
    ? (Object.fromEntries(
        REVIEW_RATINGS.map((rating) => [
          rating,
          formatInterval(preview.computedAt, preview.outcomes[rating].due),
        ]),
      ) as Record<ReviewRating, string>)
    : null

  return (
    <>
      <p className={studyStyles.status}>
        <span>{view.materialTitle}</span>
        <span>
          復習 {counts.reviewDueToday}・学習中 {counts.learningDueNow}・新規 {counts.newAvailable}
        </span>
      </p>
      <p className={studyStyles.kind}>{KIND_LABELS[item.kind]}</p>
      <StudyCard card={item.card} revealed={view.revealed} />
      {view.saveError && <p role="alert">{view.saveError}</p>}
      <div className={studyStyles.actions}>
        {view.canRetrySave ? (
          <button type="button" className={styles.primaryButton} onClick={onRetrySave}>
            もう一度保存する
          </button>
        ) : view.revealed && intervals ? (
          <RatingButtons intervals={intervals} disabled={view.saving} onRate={onRate} />
        ) : (
          <button type="button" className={styles.primaryButton} onClick={onReveal}>
            答えを見る
          </button>
        )}
      </div>
    </>
  )
}

function Done({
  view,
  onCheckAgain,
}: {
  view: Extract<StudyView, { status: 'done' }>
  onCheckAgain: () => void
}) {
  return (
    <div className={styles.panel}>
      <h2>{view.nextLearningDueAt ? '今出せるカードは終わりました' : '今日の学習は完了しました'}</h2>
      <p>今回の回答 {view.answeredTotal}問</p>
      {view.answeredTotal > 0 && (
        <ul className={studyStyles.summary}>
          {REVIEW_RATINGS.map((rating) => (
            <li key={rating}>
              {RATING_LABELS[rating].label}（{RATING_LABELS[rating].sub}） {view.answered[rating]}
            </li>
          ))}
        </ul>
      )}
      {view.nextLearningDueAt && (
        <>
          <p>次の復習まであと {formatInterval(view.checkedAt, view.nextLearningDueAt)}</p>
          <button type="button" className={styles.primaryButton} onClick={onCheckAgain}>
            もう一度確認する
          </button>
        </>
      )}
      <Link to="/">ホームに戻る</Link>
    </div>
  )
}
