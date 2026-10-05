/*
 * 認証のアプリ側の型。Firebase の User 型などはここより外に出さない
 * （変換は src/services/firebase/auth.ts で行う）。
 */

/** ログイン中の利用者 */
export interface AppUser {
  uid: string
  displayName?: string
  email?: string
  photoUrl?: string
}

/** ログインの方式 */
export type SignInMethod = 'popup' | 'redirect'

/** 認証の窓口。実装は Firebase（本番）とテスト用の偽物 */
export interface AuthGateway {
  /**
   * ログイン状態の変化を購読する。最初の通知で起動時の状態（ログイン済みか）が分かる。
   * 戻り値は購読の解除。
   */
  onAuthStateChanged(listener: (user: AppUser | null) => void): () => void
  /** Google でログインする（失敗時は AppError） */
  signIn(method: SignInMethod): Promise<void>
  /** リダイレクト方式でログインして戻ってきた場合、その結果を確認する（失敗していれば AppError） */
  completeRedirectSignIn(): Promise<void>
  signOut(): Promise<void>
}
