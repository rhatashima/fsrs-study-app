import type { FirebaseApp } from 'firebase/app'
import {
  getAuth,
  getRedirectResult,
  GoogleAuthProvider,
  onAuthStateChanged,
  signInWithPopup,
  signInWithRedirect,
  signOut,
  type User,
} from 'firebase/auth'
import type { AppUser, AuthGateway } from '../auth/types'
import { toAuthAppError } from './authErrors'

/** Firebase の User → アプリの AppUser（Firebase の型を外に出さない） */
export function toAppUser(user: Pick<User, 'uid' | 'displayName' | 'email' | 'photoURL'>): AppUser {
  return {
    uid: user.uid,
    ...(user.displayName ? { displayName: user.displayName } : {}),
    ...(user.email ? { email: user.email } : {}),
    ...(user.photoURL ? { photoUrl: user.photoURL } : {}),
  }
}

/** Firebase Authentication（Google ログイン）を使う AuthGateway */
export function createFirebaseAuthGateway(app: FirebaseApp): AuthGateway {
  const auth = getAuth(app)
  auth.languageCode = 'ja'
  const provider = new GoogleAuthProvider()
  // 複数の Google アカウントを使い分けられるよう、毎回アカウントを選ぶ
  provider.setCustomParameters({ prompt: 'select_account' })

  return {
    onAuthStateChanged(listener) {
      return onAuthStateChanged(auth, (user) => listener(user ? toAppUser(user) : null))
    },
    async signIn(method) {
      try {
        if (method === 'popup') {
          await signInWithPopup(auth, provider)
        } else {
          await signInWithRedirect(auth, provider)
        }
      } catch (error) {
        throw toAuthAppError(error)
      }
    },
    async completeRedirectSignIn() {
      try {
        await getRedirectResult(auth)
      } catch (error) {
        throw toAuthAppError(error)
      }
    },
    async signOut() {
      try {
        await signOut(auth)
      } catch (error) {
        throw toAuthAppError(error)
      }
    },
  }
}
