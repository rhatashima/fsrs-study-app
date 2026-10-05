import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { isAppError } from '../domain'
import { errorMessage } from '../lib/errorMessage'
import { isOwner } from '../services/auth/authorization'
import {
  canFallBackToRedirect,
  chooseSignInMethod,
  detectSignInEnvironment,
  type SignInEnvironment,
} from '../services/auth/signInMethod'
import type { AppUser, AuthGateway } from '../services/auth/types'
import { AuthContext, type AuthContextValue, type AuthStatus } from './authContext'

interface AuthProviderProps {
  gateway: AuthGateway
  /** 利用を許可する Owner の UID（未設定なら null） */
  ownerUid: string | null
  /** ログイン方式の判定に使う環境（テストで差し替える） */
  detectEnvironment?: () => SignInEnvironment
  children: ReactNode
}

const LOGIN_FAILED = 'ログインに失敗しました。もう一度お試しください。'

export function AuthProvider({
  gateway,
  ownerUid,
  detectEnvironment = detectSignInEnvironment,
  children,
}: AuthProviderProps) {
  /** undefined = まだ確認中 */
  const [user, setUser] = useState<AppUser | null | undefined>(undefined)
  const [signingIn, setSigningIn] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const unsubscribe = gateway.onAuthStateChanged((next) => {
      setUser(next)
      if (next) setError(null)
    })
    // リダイレクト方式のログインから戻ってきた場合、失敗していればここで分かる
    gateway.completeRedirectSignIn().catch((e: unknown) => {
      if (!(isAppError(e) && e.kind === 'cancelled')) setError(errorMessage(e, LOGIN_FAILED))
    })
    return unsubscribe
  }, [gateway])

  const signIn = useCallback(async () => {
    const env = detectEnvironment()
    const method = chooseSignInMethod(env)
    setSigningIn(true)
    setError(null)
    try {
      await gateway.signIn(method)
    } catch (e) {
      if (isAppError(e) && e.kind === 'popup-blocked' && method === 'popup' && canFallBackToRedirect(env)) {
        // ポップアップが使えない環境では、ページ遷移（リダイレクト）でやり直す
        try {
          await gateway.signIn('redirect')
        } catch (retryError) {
          setError(errorMessage(retryError, LOGIN_FAILED))
        }
      } else if (!(isAppError(e) && e.kind === 'cancelled')) {
        setError(errorMessage(e, LOGIN_FAILED))
      }
    } finally {
      setSigningIn(false)
    }
  }, [gateway, detectEnvironment])

  const signOut = useCallback(async () => {
    setError(null)
    try {
      await gateway.signOut()
    } catch (e) {
      setError(errorMessage(e, 'ログアウトできませんでした。もう一度お試しください。'))
    }
  }, [gateway])

  const value = useMemo<AuthContextValue>(() => {
    let auth: AuthStatus
    if (user === undefined) auth = { status: 'loading' }
    else if (user === null) auth = { status: 'unauthenticated' }
    else if (isOwner(user, ownerUid)) auth = { status: 'authorized', user }
    else auth = { status: 'unauthorized', user, ownerConfigured: Boolean(ownerUid) }
    return { auth, signingIn, error, signIn, signOut }
  }, [user, ownerUid, signingIn, error, signIn, signOut])

  return <AuthContext value={value}>{children}</AuthContext>
}
