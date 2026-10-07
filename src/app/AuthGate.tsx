import { useContext, useState, type ReactNode } from 'react'
import { LoginPage } from '../pages/LoginPage'
import { UnauthorizedPage } from '../pages/UnauthorizedPage'
import type { AppUser } from '../services/auth/types'
import styles from '../pages/Page.module.css'
import { useAuth } from './authContext'
import { RepositoryContext, RepositoryFactoryContext, type RepositoryFactory } from './repositoryContext'
import { StudyBasicsHandoff, StudyHandoffContext } from './studyHandoffContext'

/**
 * Owner としてログインしているときだけ children（アプリの画面）を表示する。
 * 未ログインならログイン画面をその URL のまま表示するので、ログイン後は元の画面に戻る。
 */
export function AuthGate({ children }: { children: ReactNode }) {
  const { auth } = useAuth()
  const factory = useContext(RepositoryFactoryContext)
  if (!factory) throw new Error('RepositoryFactoryContext.Provider が設定されていません')

  switch (auth.status) {
    case 'loading':
      return (
        <main className={`${styles.page} ${styles.standalone}`} aria-busy="true">
          <p className={styles.muted}>確認中…</p>
        </main>
      )
    case 'unauthenticated':
      return <LoginPage />
    case 'unauthorized':
      return <UnauthorizedPage user={auth.user} ownerConfigured={auth.ownerConfigured} />
    case 'authorized':
      // 利用者が変わったら（ログアウト → 別アカウントなど）データ層を作り直す
      return (
        <UserScope key={auth.user.uid} user={auth.user} factory={factory}>
          {children}
        </UserScope>
      )
  }
}

function UserScope({ user, factory, children }: { user: AppUser; factory: RepositoryFactory; children: ReactNode }) {
  const [repositories] = useState(() => factory(user))
  const [handoff] = useState(() => new StudyBasicsHandoff())
  return (
    <RepositoryContext value={repositories}>
      <StudyHandoffContext value={handoff}>{children}</StudyHandoffContext>
    </RepositoryContext>
  )
}
