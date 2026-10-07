import { useEffect, useState } from 'react'
import { Link } from 'react-router'
import { useClock } from '../app/clockContext'
import { useRepositories } from '../app/repositoryContext'
import { isCorruptedReviewStateError } from '../domain'
import { errorMessage } from '../lib/errorMessage'
import { perfAsync, perfBegin, perfMark } from '../lib/perf'
import { formatInterval } from '../lib/formatInterval'
import { loadStudyOverview, selectCurrentMaterial, type StudyOverview } from '../services/studyService'
import styles from './Page.module.css'
import homeStyles from './HomePage.module.css'

type LoadState =
  | { status: 'loading' }
  | { status: 'error'; message: string; corrupted: boolean }
  | { status: 'no-material' }
  | { status: 'loaded'; overview: StudyOverview; now: Date }

export function HomePage() {
  const repos = useRepositories()
  const clock = useClock()
  const [state, setState] = useState<LoadState>({ status: 'loading' })

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        perfMark('home:load-start')
        const material = await perfAsync('home:selectCurrentMaterial', () => selectCurrentMaterial(repos))
        if (!material) {
          if (!cancelled) setState({ status: 'no-material' })
          return
        }
        const now = clock()
        const overview = await perfAsync('home:loadStudyOverview', () => loadStudyOverview(repos, material.id, now))
        perfMark('home:data-loaded')
        if (!cancelled) setState({ status: 'loaded', overview, now })
      } catch (error) {
        if (!cancelled) {
          setState({
            status: 'error',
            message: errorMessage(error, '読み込めませんでした。再読み込みしてください。'),
            corrupted: isCorruptedReviewStateError(error),
          })
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [repos, clock])

  return (
    <section className={styles.page}>
      <h1 className={styles.title}>ホーム</h1>
      {state.status === 'loading' && <p className={styles.muted}>読み込み中…</p>}
      {state.status === 'error' && (
        <div className={styles.panel}>
          <p role="alert">{state.message}</p>
          {state.corrupted && <Link to="/study">学習画面で復元する</Link>}
        </div>
      )}
      {state.status === 'no-material' && (
        <div className={styles.panel}>
          <p className={styles.muted}>教材がありません。教材を登録すると、ここに今日の学習が表示されます。</p>
        </div>
      )}
      {state.status === 'loaded' && <Overview overview={state.overview} now={state.now} />}
    </section>
  )
}

function Overview({ overview, now }: { overview: StudyOverview; now: Date }) {
  const { material, counts } = overview
  const available = counts.reviewDueToday + counts.learningDueNow + counts.newAvailable
  return (
    <>
      <p className={homeStyles.material}>
        <span className={styles.muted}>学習中の教材</span>
        <strong>{material.title}</strong>
      </p>
      <dl className={homeStyles.counts}>
        <div>
          <dt>今日の復習</dt>
          <dd>{counts.reviewDueToday}</dd>
        </div>
        <div>
          <dt>学習中</dt>
          <dd>{counts.learningDueNow}</dd>
        </div>
        <div>
          <dt>新規</dt>
          <dd>{counts.newAvailable}</dd>
        </div>
      </dl>
      {available === 0 && (
        <p className={styles.muted}>
          {counts.nextLearningDueAt
            ? `学習中のカードはあと ${formatInterval(now, counts.nextLearningDueAt)}で出題されます。`
            : '今日の学習は完了しています。'}
        </p>
      )}
      <Link to="/study" className={styles.primaryButton} onClick={() => perfBegin('study-start')}>
        学習を始める
      </Link>
    </>
  )
}
