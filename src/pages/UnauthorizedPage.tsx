import { useAuth } from '../app/authContext'
import type { AppUser } from '../services/auth/types'
import styles from './Page.module.css'

interface UnauthorizedPageProps {
  user: AppUser
  /** VITE_OWNER_UID が設定されているか */
  ownerConfigured: boolean
}

export function UnauthorizedPage({ user, ownerConfigured }: UnauthorizedPageProps) {
  const { signOut, error } = useAuth()
  return (
    <main className={`${styles.page} ${styles.standalone}`}>
      <h1 className={styles.title}>このアカウントには利用権限がありません</h1>
      <p className={styles.muted}>
        {user.email ? `${user.email} でログインしています。` : 'ログインしています。'}
        別のアカウントでログインするには、いったんログアウトしてください。
      </p>
      {!ownerConfigured && (
        <div className={styles.panel}>
          <p>
            利用を許可するアカウント（Owner）がまだ設定されていません。自分のアカウントの場合は、次の UID を
            <code>.env.local</code> の <code>VITE_OWNER_UID</code> に設定して、開発サーバーを再起動してください。
          </p>
          <p>
            UID：<code>{user.uid}</code>
          </p>
        </div>
      )}
      {error && <p role="alert">{error}</p>}
      <button type="button" className={styles.primaryButton} onClick={() => void signOut()}>
        ログアウト
      </button>
    </main>
  )
}
