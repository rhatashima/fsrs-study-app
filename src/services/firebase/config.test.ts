// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { readFirebaseConfig } from './config'

const FULL = {
  VITE_FIREBASE_API_KEY: 'test-api-key',
  VITE_FIREBASE_AUTH_DOMAIN: 'demo-project.firebaseapp.com',
  VITE_FIREBASE_PROJECT_ID: 'demo-project',
  VITE_FIREBASE_APP_ID: '1:123:web:abc',
  VITE_OWNER_UID: 'owner-uid',
}

describe('readFirebaseConfig', () => {
  it('環境変数を Firebase の設定に変換する', () => {
    expect(readFirebaseConfig(FULL)).toEqual({
      ok: true,
      config: {
        apiKey: 'test-api-key',
        authDomain: 'demo-project.firebaseapp.com',
        projectId: 'demo-project',
        appId: '1:123:web:abc',
      },
      ownerUid: 'owner-uid',
    })
  })

  it('前後の空白を取り除く', () => {
    const result = readFirebaseConfig({ ...FULL, VITE_FIREBASE_PROJECT_ID: '  demo-project \n' })
    expect(result.ok && result.config.projectId).toBe('demo-project')
  })

  it('不足している必須項目の変数名だけを返す（値は返さない）', () => {
    const result = readFirebaseConfig({ VITE_FIREBASE_API_KEY: 'secret-looking-value', VITE_FIREBASE_APP_ID: '  ' })
    expect(result).toEqual({
      ok: false,
      missing: ['VITE_FIREBASE_AUTH_DOMAIN', 'VITE_FIREBASE_PROJECT_ID', 'VITE_FIREBASE_APP_ID'],
    })
    expect(JSON.stringify(result)).not.toContain('secret-looking-value')
  })

  it('何も設定されていない（.env.local がない）', () => {
    const result = readFirebaseConfig({ MODE: 'development', DEV: true })
    expect(result.ok).toBe(false)
    expect(!result.ok && result.missing).toHaveLength(4)
  })

  it('VITE_OWNER_UID は任意（未設定なら null）', () => {
    const withoutOwner = Object.fromEntries(Object.entries(FULL).filter(([key]) => key !== 'VITE_OWNER_UID'))
    expect(readFirebaseConfig(withoutOwner)).toMatchObject({ ok: true, ownerUid: null })
    expect(readFirebaseConfig({ ...FULL, VITE_OWNER_UID: '' })).toMatchObject({ ok: true, ownerUid: null })
  })

  it('Web 設定に不要な項目（messagingSenderId など）は含めない', () => {
    const result = readFirebaseConfig({ ...FULL, VITE_FIREBASE_MESSAGING_SENDER_ID: '123' })
    expect(result.ok && Object.keys(result.config).sort()).toEqual(['apiKey', 'appId', 'authDomain', 'projectId'])
  })
})
