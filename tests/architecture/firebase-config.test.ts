// @vitest-environment node
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

/*
 * firebase.json の Hosting 設定の確認。
 * Firebase Hosting の regex は RE2 で、先読み・後読み・後方参照（(?= (?! (?<= (?<! \1 など）を使えない
 * （使うとデプロイの最後に HTTP 400 で失敗する。dry-run では検出されない）。
 */
interface HostingHeader {
  source?: string
  regex?: string
  headers: { key: string; value: string }[]
}

const config = JSON.parse(readFileSync(new URL('../../firebase.json', import.meta.url), 'utf8')) as {
  hosting: { public: string; rewrites: { source: string; destination: string }[]; headers: HostingHeader[] }
}
const regexHeaders = config.hosting.headers.filter((h): h is HostingHeader & { regex: string } => Boolean(h.regex))

describe('firebase.json（Hosting）', () => {
  it('Vite の出力（dist）を配信し、すべての URL を index.html に振り向ける（SPA）', () => {
    expect(config.hosting.public).toBe('dist')
    expect(config.hosting.rewrites).toContainEqual({ source: '**', destination: '/index.html' })
  })

  it.each(regexHeaders.map((h) => [h.regex]))('regex %s は RE2 で使えない構文を含まない', (regex) => {
    expect(regex).not.toMatch(/\(\?[=!<]|\\[1-9]/)
  })

  it('/assets/ 以外は no-cache、/assets/ は長期キャッシュ', () => {
    const noCache = regexHeaders.find((h) => h.headers.some((x) => x.key === 'Cache-Control' && x.value === 'no-cache'))
    expect(noCache).toBeDefined()
    const re = new RegExp(noCache?.regex ?? '')
    for (const path of ['/', '/index.html', '/study', '/settings', '/favicon.svg', '/assetsx', '/a']) {
      expect(re.test(path), path).toBe(true)
    }
    for (const path of ['/assets/index-abc.js', '/assets/index-abc.css']) {
      expect(re.test(path), path).toBe(false)
    }
    expect(config.hosting.headers).toContainEqual({
      source: '/assets/**',
      headers: [{ key: 'Cache-Control', value: 'public, max-age=31536000, immutable' }],
    })
  })
})
