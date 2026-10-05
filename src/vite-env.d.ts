/// <reference types="vite/client" />

/** .env.local で設定する環境変数（.env.example 参照） */
interface ImportMetaEnv {
  readonly VITE_FIREBASE_API_KEY?: string
  readonly VITE_FIREBASE_AUTH_DOMAIN?: string
  readonly VITE_FIREBASE_PROJECT_ID?: string
  readonly VITE_FIREBASE_APP_ID?: string
  readonly VITE_OWNER_UID?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
