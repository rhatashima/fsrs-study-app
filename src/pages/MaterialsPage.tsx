import { useEffect, useState } from 'react'
import { Link } from 'react-router'
import { useRepositories } from '../app/repositoryContext'
import { unstudiedCards, type MaterialProgress, type StudyMaterial } from '../domain'
import styles from './Page.module.css'

interface MaterialSummary {
  material: StudyMaterial
  progress: MaterialProgress
}

type LoadState =
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'loaded'; summaries: MaterialSummary[] }

export function MaterialsPage() {
  const { materials, reviews } = useRepositories()
  const [state, setState] = useState<LoadState>({ status: 'loading' })

  useEffect(() => {
    let cancelled = false
    materials
      .list()
      .then((list) =>
        Promise.all(
          list.map(async (material) => ({ material, progress: await reviews.getProgress(material.id) })),
        ),
      )
      .then((summaries) => {
        if (!cancelled) setState({ status: 'loaded', summaries })
      })
      .catch(() => {
        if (!cancelled) setState({ status: 'error' })
      })
    return () => {
      cancelled = true
    }
  }, [materials, reviews])

  return (
    <section className={styles.page}>
      <h1 className={styles.title}>教材</h1>
      {state.status === 'loading' && <p className={styles.muted}>読み込み中…</p>}
      {state.status === 'error' && <p role="alert">教材を読み込めませんでした。再読み込みしてください。</p>}
      {state.status === 'loaded' && state.summaries.length === 0 && (
        <div className={styles.panel}>
          <p className={styles.muted}>教材はまだ登録されていません。</p>
        </div>
      )}
      {state.status === 'loaded' &&
        state.summaries.map(({ material, progress }) => (
          <article key={material.id} className={styles.panel} aria-label={material.title}>
            <h2>{material.title}</h2>
            <p className={styles.muted}>
              カード {progress.totalCards} 枚（未学習 {unstudiedCards(progress)} 枚）
            </p>
            <Link to={`/materials/${encodeURIComponent(material.id)}/import`}>問題をインポート</Link>
          </article>
        ))}
    </section>
  )
}
