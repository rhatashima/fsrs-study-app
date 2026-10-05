import { useAuth } from '../app/authContext'
import styles from './Page.module.css'

export function LoginPage() {
  const { signIn, signingIn, error } = useAuth()
  return (
    <main className={`${styles.page} ${styles.standalone}`}>
      <h1 className={styles.title}>FSRS 学習</h1>
      <p className={styles.muted}>個人用の学習アプリです。利用を許可された Google アカウントでログインしてください。</p>
      {error && <p role="alert">{error}</p>}
      <button
        type="button"
        className={styles.primaryButton}
        onClick={() => void signIn()}
        disabled={signingIn}
      >
        {signingIn ? 'ログイン中…' : 'Googleでログイン'}
      </button>
    </main>
  )
}
