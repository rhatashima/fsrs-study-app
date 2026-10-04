import { Link } from 'react-router'
import styles from './Page.module.css'

export function HomePage() {
  return (
    <section className={styles.page}>
      <h1 className={styles.title}>ホーム</h1>
      <div className={styles.panel}>
        <p className={styles.muted}>教材を選ぶと、今日の復習カード数と新規カード数がここに表示されます。</p>
      </div>
      <Link to="/study" className={styles.primaryButton}>
        学習を始める
      </Link>
    </section>
  )
}
