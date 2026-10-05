const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

/**
 * from から to までの間隔を、人が読みやすい日本語にする（表示専用。due 自体は変えない）。
 * 例：「1分未満」「10分」「3時間」「4日」「2.5か月」「1.2年」
 */
export function formatInterval(from: Date, to: Date): string {
  const ms = Math.max(0, to.getTime() - from.getTime())
  if (ms < MINUTE) return '1分未満'
  if (ms < HOUR) return `${Math.round(ms / MINUTE)}分`
  if (ms < DAY) {
    const hours = Math.round(ms / HOUR)
    return hours >= 24 ? '1日' : `${hours}時間`
  }
  const days = ms / DAY
  if (days < 30) return `${Math.round(days)}日`
  if (days < 365) return `${trimDecimal(days / 30)}か月`
  return `${trimDecimal(days / 365)}年`
}

/** 10 未満は小数第 1 位まで（1.0 → 1）、10 以上は整数 */
function trimDecimal(value: number): string {
  const rounded = value < 10 ? Math.round(value * 10) / 10 : Math.round(value)
  return String(rounded)
}
