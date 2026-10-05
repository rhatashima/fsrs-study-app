import { createContext, useContext } from 'react'
import type { AppUser } from '../services/auth/types'

/**
 * 認証の状態。
 * - loading：起動直後、ログイン状態を確認中（アプリ画面もログイン画面も出さない）
 * - unauthenticated：未ログイン
 * - authorized：Owner としてログイン中
 * - unauthorized：Owner 以外のアカウントでログイン中
 */
export type AuthStatus =
  | { status: 'loading' }
  | { status: 'unauthenticated' }
  | { status: 'authorized'; user: AppUser }
  | { status: 'unauthorized'; user: AppUser; ownerConfigured: boolean }

export interface AuthContextValue {
  auth: AuthStatus
  /** ログイン中（ポップアップ表示中など） */
  signingIn: boolean
  /** 直近のログイン・ログアウトの失敗（日本語） */
  error: string | null
  signIn: () => Promise<void>
  signOut: () => Promise<void>
}

export const AuthContext = createContext<AuthContextValue | null>(null)

export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext)
  if (!value) throw new Error('AuthProvider が設定されていません')
  return value
}
