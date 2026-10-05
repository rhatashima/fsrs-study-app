/** 学習日を表す "YYYY-MM-DD"（端末のローカル時刻基準） */
export type DayKey = string

export const DEFAULT_DAY_START_HOUR = 4

/**
 * 日時が属する学習日。dayStartHour 時より前は前日として扱う
 * （初期値 4 時：深夜 0〜4 時の学習は前日分に数える）。
 */
export function toDayKey(date: Date, dayStartHour: number = DEFAULT_DAY_START_HOUR): DayKey {
  const shifted = new Date(date.getTime())
  shifted.setHours(shifted.getHours() - dayStartHour)
  const y = shifted.getFullYear()
  const m = String(shifted.getMonth() + 1).padStart(2, '0')
  const d = String(shifted.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}
