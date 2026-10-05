// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { isOwner } from './authorization'
import {
  canFallBackToRedirect,
  chooseSignInMethod,
  detectSignInEnvironment,
  type SignInEnvironment,
} from './signInMethod'

const env = (overrides: Partial<SignInEnvironment>): SignInEnvironment => ({
  hostname: 'demo-project.firebaseapp.com',
  isStandalone: false,
  isTouchPrimary: false,
  ...overrides,
})

describe('chooseSignInMethod', () => {
  it.each(['localhost', '127.0.0.1', 'app.localhost'])('ローカル開発（%s）はポップアップ', (hostname) => {
    expect(chooseSignInMethod(env({ hostname }))).toBe('popup')
    // localhost ではスマホ・PWA 相当でもリダイレクトに依存しない
    expect(chooseSignInMethod(env({ hostname, isStandalone: true, isTouchPrimary: true }))).toBe('popup')
  })

  it('PC ブラウザはポップアップ', () => {
    expect(chooseSignInMethod(env({}))).toBe('popup')
  })

  it('ホーム画面に追加した PWA（standalone）はリダイレクト', () => {
    expect(chooseSignInMethod(env({ isStandalone: true }))).toBe('redirect')
  })

  it('スマートフォン（主な入力がタッチ）はリダイレクト', () => {
    expect(chooseSignInMethod(env({ isTouchPrimary: true }))).toBe('redirect')
  })
})

describe('canFallBackToRedirect', () => {
  it('ポップアップがブロックされたとき、localhost 以外ではリダイレクトでやり直せる', () => {
    expect(canFallBackToRedirect(env({}))).toBe(true)
    expect(canFallBackToRedirect(env({ hostname: 'localhost' }))).toBe(false)
  })
})

describe('detectSignInEnvironment', () => {
  function fakeWindow(options: { hostname: string; media: string[]; iosStandalone?: boolean }) {
    return {
      location: { hostname: options.hostname },
      navigator: options.iosStandalone ? { standalone: true } : {},
      matchMedia: (query: string) => ({ matches: options.media.includes(query) }),
    } as unknown as Window
  }

  it('display-mode: standalone を PWA として判定する', () => {
    const detected = detectSignInEnvironment(
      fakeWindow({ hostname: 'x.firebaseapp.com', media: ['(display-mode: standalone)'] }),
    )
    expect(detected).toEqual({ hostname: 'x.firebaseapp.com', isStandalone: true, isTouchPrimary: false })
  })

  it('iOS のホーム画面起動（navigator.standalone）も PWA として判定する', () => {
    expect(detectSignInEnvironment(fakeWindow({ hostname: 'x', media: [], iosStandalone: true })).isStandalone).toBe(true)
  })

  it('タッチ主体（pointer: coarse かつ hover なし）をスマートフォンとして判定する', () => {
    expect(detectSignInEnvironment(fakeWindow({ hostname: 'x', media: ['(pointer: coarse)'] })).isTouchPrimary).toBe(true)
    expect(
      detectSignInEnvironment(fakeWindow({ hostname: 'x', media: ['(pointer: coarse)', '(hover: hover)'] }))
        .isTouchPrimary,
    ).toBe(false)
  })
})

describe('isOwner', () => {
  it('Owner UID と一致すれば許可', () => {
    expect(isOwner({ uid: 'owner' }, 'owner')).toBe(true)
  })
  it('一致しなければ不許可', () => {
    expect(isOwner({ uid: 'other' }, 'owner')).toBe(false)
  })
  it('Owner UID が未設定なら誰も許可しない', () => {
    expect(isOwner({ uid: 'owner' }, null)).toBe(false)
    expect(isOwner({ uid: '' }, '')).toBe(false)
  })
})
