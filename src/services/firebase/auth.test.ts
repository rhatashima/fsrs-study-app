// @vitest-environment node
import type { FirebaseApp } from 'firebase/app'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AppError } from '../../domain'

// Firebase Authentication SDK を偽物に置き換える（実際の通信はしない）
const sdk = vi.hoisted(() => ({
  auth: { languageCode: null as string | null },
  getAuth: vi.fn(),
  signInWithPopup: vi.fn(),
  signInWithRedirect: vi.fn(),
  getRedirectResult: vi.fn(),
  onAuthStateChanged: vi.fn(),
  signOut: vi.fn(),
  setCustomParameters: vi.fn(),
}))

vi.mock('firebase/auth', () => ({
  getAuth: sdk.getAuth,
  signInWithPopup: sdk.signInWithPopup,
  signInWithRedirect: sdk.signInWithRedirect,
  getRedirectResult: sdk.getRedirectResult,
  onAuthStateChanged: sdk.onAuthStateChanged,
  signOut: sdk.signOut,
  GoogleAuthProvider: class {
    setCustomParameters = sdk.setCustomParameters
  },
}))

const { createFirebaseAuthGateway, toAppUser } = await import('./auth')
const { toAuthAppError } = await import('./authErrors')

const app = {} as FirebaseApp

beforeEach(() => {
  vi.clearAllMocks()
  sdk.getAuth.mockReturnValue(sdk.auth)
})

describe('toAppUser（Firebase の User → AppUser）', () => {
  it('必要な項目だけを取り出す', () => {
    expect(
      toAppUser({ uid: 'u1', displayName: '山田', email: 'a@example.com', photoURL: 'https://example.com/p.png' }),
    ).toEqual({ uid: 'u1', displayName: '山田', email: 'a@example.com', photoUrl: 'https://example.com/p.png' })
  })

  it('null の項目は含めない', () => {
    expect(toAppUser({ uid: 'u1', displayName: null, email: null, photoURL: null })).toEqual({ uid: 'u1' })
  })
})

describe('createFirebaseAuthGateway', () => {
  it('ポップアップ方式は signInWithPopup、リダイレクト方式は signInWithRedirect を使う', async () => {
    const gateway = createFirebaseAuthGateway(app)
    await gateway.signIn('popup')
    expect(sdk.signInWithPopup).toHaveBeenCalledTimes(1)
    expect(sdk.signInWithRedirect).not.toHaveBeenCalled()

    await gateway.signIn('redirect')
    expect(sdk.signInWithRedirect).toHaveBeenCalledTimes(1)
  })

  it('Google の画面を日本語にし、アカウントを選べるようにする', () => {
    createFirebaseAuthGateway(app)
    expect(sdk.auth.languageCode).toBe('ja')
    expect(sdk.setCustomParameters).toHaveBeenCalledWith({ prompt: 'select_account' })
  })

  it('認証状態の通知を AppUser に変換する', () => {
    const unsubscribe = vi.fn()
    sdk.onAuthStateChanged.mockImplementation((_auth, callback: (user: unknown) => void) => {
      callback({ uid: 'u1', displayName: null, email: 'a@example.com', photoURL: null, getIdToken: vi.fn() })
      callback(null)
      return unsubscribe
    })
    const listener = vi.fn()
    const stop = createFirebaseAuthGateway(app).onAuthStateChanged(listener)
    expect(listener.mock.calls).toEqual([[{ uid: 'u1', email: 'a@example.com' }], [null]])
    stop()
    expect(unsubscribe).toHaveBeenCalled()
  })

  it('SDK のエラーを日本語の AppError に変換する', async () => {
    sdk.signInWithPopup.mockRejectedValue({ code: 'auth/popup-blocked' })
    sdk.getRedirectResult.mockRejectedValue({ code: 'auth/network-request-failed' })
    const gateway = createFirebaseAuthGateway(app)
    await expect(gateway.signIn('popup')).rejects.toMatchObject({ kind: 'popup-blocked' })
    await expect(gateway.completeRedirectSignIn()).rejects.toMatchObject({ kind: 'network' })
  })
})

describe('toAuthAppError', () => {
  it.each([
    ['auth/popup-closed-by-user', 'cancelled'],
    ['auth/cancelled-popup-request', 'cancelled'],
    ['auth/popup-blocked', 'popup-blocked'],
    ['auth/network-request-failed', 'network'],
    ['auth/unauthorized-domain', 'configuration'],
    ['auth/operation-not-allowed', 'configuration'],
    ['auth/invalid-api-key', 'configuration'],
    ['auth/api-key-not-valid.-please-pass-a-valid-api-key.', 'configuration'],
    ['auth/something-new', 'unknown'],
  ])('%s → %s', (code, kind) => {
    const error = toAuthAppError({ code })
    expect(error).toBeInstanceOf(AppError)
    expect(error.kind).toBe(kind)
    expect(error.message).toMatch(/[ぁ-んァ-ン]/)
  })

  it('承認済みドメインの設定を案内する', () => {
    expect(toAuthAppError({ code: 'auth/unauthorized-domain' }).message).toContain('承認済みドメイン')
  })

  it('コードのないエラーも日本語にする', () => {
    expect(toAuthAppError(new Error('boom')).message).toBe('ログインに失敗しました。もう一度お試しください。')
  })
})
