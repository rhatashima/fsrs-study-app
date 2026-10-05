import type { AppUser, AuthGateway, SignInMethod } from '../services/auth/types'

export const OWNER: AppUser = { uid: 'owner-uid', displayName: 'オーナー', email: 'owner@example.com' }
export const STRANGER: AppUser = { uid: 'other-uid', email: 'other@example.com' }

export interface FakeAuth {
  gateway: AuthGateway
  signInCalls: SignInMethod[]
  signInImpl: (method: SignInMethod) => Promise<void>
  redirectResult: () => Promise<void>
  emit: (user: AppUser | null) => void
}

/**
 * テスト用の AuthGateway（Firebase と通信しない）。
 * emit で認証状態を変え、signInImpl で signIn の結果を差し替えられる。
 */
export function createFakeAuthGateway(options: { initialUser?: AppUser | null | 'pending' } = {}): FakeAuth {
  const listeners = new Set<(user: AppUser | null) => void>()
  let current: AppUser | null | 'pending' = options.initialUser === undefined ? OWNER : options.initialUser
  const signInCalls: SignInMethod[] = []

  const emit = (user: AppUser | null) => {
    current = user
    for (const listener of listeners) listener(user)
  }

  const fake: FakeAuth = {
    signInCalls,
    /** signIn の動作（既定：Owner としてログインする） */
    signInImpl: (): Promise<void> => {
      emit(OWNER)
      return Promise.resolve()
    },
    /** completeRedirectSignIn の結果（既定：何もない） */
    redirectResult: (): Promise<void> => Promise.resolve(),
    emit,
    gateway: {
      onAuthStateChanged(listener) {
        listeners.add(listener)
        // Firebase と同様に、登録後に現在の状態を 1 回通知する（pending の間は通知しない＝確認中）
        if (current !== 'pending') listener(current)
        return () => listeners.delete(listener)
      },
      signIn(method): Promise<void> {
        signInCalls.push(method)
        return fake.signInImpl(method)
      },
      completeRedirectSignIn: (): Promise<void> => fake.redirectResult(),
      signOut() {
        emit(null)
        return Promise.resolve()
      },
    },
  }
  return fake
}
