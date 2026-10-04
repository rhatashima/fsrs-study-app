import { Link } from 'react-router'
import styles from '../pages/Page.module.css'

/** 画面の描画中に予期しないエラーが起きたときの表示（アプリ全体を落とさない） */
export function RouteErrorPage() {
  return (
    <main className={`${styles.page} ${styles.standalone}`}>
      <h1 className={styles.title}>問題が発生しました</h1>
      <p className={styles.muted}>画面を表示できませんでした。ページを再読み込みしてください。</p>
      <Link to="/">ホームに戻る</Link>
    </main>
  )
}
