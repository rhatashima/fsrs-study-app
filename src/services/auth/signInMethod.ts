import type { SignInMethod } from './types'

/** ログイン方式の判定に使う環境の情報 */
export interface SignInEnvironment {
  hostname: string
  /** ホーム画面に追加した PWA として起動している */
  isStandalone: boolean
  /** 主な入力がタッチ（スマートフォン・タブレット） */
  isTouchPrimary: boolean
}

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', '::1'])

export function isLocalHost(hostname: string): boolean {
  return LOCAL_HOSTS.has(hostname) || hostname.endsWith('.localhost')
}

/**
 * ログイン方式を選ぶ。
 * - ローカル開発（localhost）：ポップアップ（リダイレクトに依存しない）
 * - ホーム画面に追加した PWA・スマートフォン：リダイレクト（ポップアップが不安定なため）
 * - PC ブラウザ：ポップアップ
 */
export function chooseSignInMethod(env: SignInEnvironment): SignInMethod {
  if (isLocalHost(env.hostname)) return 'popup'
  if (env.isStandalone || env.isTouchPrimary) return 'redirect'
  return 'popup'
}

/** ポップアップがブロックされたとき、リダイレクトでやり直してよいか（localhost では行わない） */
export function canFallBackToRedirect(env: SignInEnvironment): boolean {
  return !isLocalHost(env.hostname)
}

/** ブラウザから環境の情報を読み取る（User-Agent の解析はしない） */
export function detectSignInEnvironment(win: Window = window): SignInEnvironment {
  const matches = (query: string) => win.matchMedia?.(query).matches ?? false
  const iosStandalone = (win.navigator as Navigator & { standalone?: boolean }).standalone === true
  return {
    hostname: win.location.hostname,
    isStandalone: matches('(display-mode: standalone)') || iosStandalone,
    isTouchPrimary: matches('(pointer: coarse)') && !matches('(hover: hover)'),
  }
}
