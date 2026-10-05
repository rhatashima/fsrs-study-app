// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { formatInterval } from './formatInterval'

const T = new Date('2026-10-05T10:00:00+09:00')
const after = (ms: number) => new Date(T.getTime() + ms)
const MIN = 60_000
const HOUR = 60 * MIN
const DAY = 24 * HOUR

describe('formatInterval', () => {
  it.each([
    [0, '1分未満'],
    [30_000, '1分未満'],
    [MIN, '1分'],
    [6 * MIN, '6分'],
    [10 * MIN, '10分'],
    [59 * MIN, '59分'],
    [HOUR, '1時間'],
    [5 * HOUR + 20 * MIN, '5時間'],
    [23 * HOUR + 40 * MIN, '1日'],
    [DAY, '1日'],
    [4 * DAY, '4日'],
    [29 * DAY, '29日'],
    [45 * DAY, '1.5か月'],
    [90 * DAY, '3か月'],
    [364 * DAY, '12か月'],
    [365 * DAY, '1年'],
    [438 * DAY, '1.2年'],
    [36500 * DAY, '100年'],
  ])('%i ミリ秒 → %s', (ms, expected) => {
    expect(formatInterval(T, after(ms))).toBe(expected)
  })

  it('過去の日時は「1分未満」', () => {
    expect(formatInterval(T, after(-HOUR))).toBe('1分未満')
  })
})
