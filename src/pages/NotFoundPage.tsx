import { Link } from 'react-router'
import styles from './Page.module.css'

export function NotFoundPage() {
  return (
    <section className={styles.page}>
      <h1 className={styles.title}>ページが見つかりません</h1>
      <Link to="/">ホームに戻る</Link>
    </section>
  )
}
