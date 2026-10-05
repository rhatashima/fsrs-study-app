/** Firebase Web アプリの設定（Authentication / Firestore に必要な項目だけ） */
export interface FirebaseWebConfig {
  apiKey: string
  authDomain: string
  projectId: string
  appId: string
}

export type FirebaseConfigResult =
  | { ok: true; config: FirebaseWebConfig; ownerUid: string | null }
  | { ok: false; missing: string[] }

/** 必須の環境変数と、FirebaseWebConfig の項目の対応 */
const REQUIRED_KEYS = {
  VITE_FIREBASE_API_KEY: 'apiKey',
  VITE_FIREBASE_AUTH_DOMAIN: 'authDomain',
  VITE_FIREBASE_PROJECT_ID: 'projectId',
  VITE_FIREBASE_APP_ID: 'appId',
} as const satisfies Record<string, keyof FirebaseWebConfig>

export const OWNER_UID_KEY = 'VITE_OWNER_UID'

type Env = Record<string, unknown>

function readString(env: Env, key: string): string | null {
  const value = env[key]
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed === '' ? null : trimmed
}

/**
 * 環境変数（import.meta.env）から Firebase の設定を読み取る。
 * 不足している場合は、不足している変数名だけを返す（値は返さない・ログに出さない）。
 * VITE_OWNER_UID は任意：未設定の場合はどのアカウントも利用できず、ログイン後の画面で自分の UID を確認できる。
 */
export function readFirebaseConfig(env: Env): FirebaseConfigResult {
  const missing: string[] = []
  const config: Partial<FirebaseWebConfig> = {}
  for (const [envKey, configKey] of Object.entries(REQUIRED_KEYS)) {
    const value = readString(env, envKey)
    if (value === null) missing.push(envKey)
    else config[configKey] = value
  }
  if (missing.length > 0) return { ok: false, missing }
  return { ok: true, config: config as FirebaseWebConfig, ownerUid: readString(env, OWNER_UID_KEY) }
}
