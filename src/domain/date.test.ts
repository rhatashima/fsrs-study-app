// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { studyDayEnd, toDayKey } from './date'

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

  it('要件の例：10/6 3:00 は 10/5 の学習日、10/6 4:01 は 10/6 の学習日', () => {
    expect(toDayKey(local(2026, 10, 6, 3, 0), 4)).toBe('2026-10-05')
    expect(toDayKey(local(2026, 10, 6, 4, 1), 4)).toBe('2026-10-06')
  })
})

describe('studyDayEnd（現在の学習日の終わり）', () => {
  it('4 時以降なら翌日の 4:00', () => {
    expect(studyDayEnd(local(2026, 10, 6, 4, 1), 4)).toEqual(local(2026, 10, 7, 4, 0))
    expect(studyDayEnd(local(2026, 10, 6, 23, 59), 4)).toEqual(local(2026, 10, 7, 4, 0))
  })

  it('ちょうど 4:00 は新しい学習日の始まり', () => {
    expect(studyDayEnd(local(2026, 10, 6, 4, 0), 4)).toEqual(local(2026, 10, 7, 4, 0))
  })

  it('4 時より前は同じ日の 4:00（前日の学習日の終わり）', () => {
    expect(studyDayEnd(local(2026, 10, 6, 3, 0), 4)).toEqual(local(2026, 10, 6, 4, 0))
  })

  it('月末・年末をまたぐ', () => {
    expect(studyDayEnd(local(2026, 12, 31, 10, 0), 4)).toEqual(local(2027, 1, 1, 4, 0))
  })

  it('学習日の終わりは toDayKey の学習日が切り替わる時刻と一致する', () => {
    const now = local(2026, 10, 6, 15, 0)
    const end = studyDayEnd(now, 4)
    expect(toDayKey(new Date(end.getTime() - 1), 4)).toBe(toDayKey(now, 4))
    expect(toDayKey(end, 4)).not.toBe(toDayKey(now, 4))
  })
})
