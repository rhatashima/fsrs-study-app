import { useAuth } from '../app/authContext'
import styles from './Page.module.css'

export function SettingsPage() {
  const { auth, signOut, error } = useAuth()
  const user = auth.status === 'authorized' ? auth.user : null
  return (
    <section className={styles.page}>
      <h1 className={styles.title}>設定</h1>
      <div className={styles.panel}>
        <h2>アカウント</h2>
        {user && <p className={styles.muted}>{user.email ?? user.displayName ?? 'ログイン中'}</p>}
        {error && <p role="alert">{error}</p>}
        <button type="button" className={styles.primaryButton} onClick={() => void signOut()}>
          ログアウト
        </button>
      </div>
      <div className={styles.panel}>
        <p className={styles.muted}>学習の設定項目は今後追加されます。</p>
      </div>
    </section>
  )
}
