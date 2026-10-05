// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { toDayKey } from './date'

// 端末のローカル時刻で作る（実行環境のタイムゾーンに依存しない）
const local = (y: number, m: number, d: number, h: number, min = 0) => new Date(y, m - 1, d, h, min)

describe('toDayKey（学習日）', () => {
  it('区切り時刻（既定 4 時）以降はその日', () => {
    expect(toDayKey(local(2026, 10, 5, 4, 0))).toBe('2026-10-05')
    expect(toDayKey(local(2026, 10, 5, 23, 59))).toBe('2026-10-05')
  })

  it('区切り時刻より前は前日として扱う', () => {
    expect(toDayKey(local(2026, 10, 5, 3, 59))).toBe('2026-10-04')
    expect(toDayKey(local(2026, 1, 1, 1, 0))).toBe('2025-12-31')
  })

  it('区切り時刻 0 時なら暦どおり', () => {
    expect(toDayKey(local(2026, 10, 5, 0, 0), 0)).toBe('2026-10-05')
  })
})
