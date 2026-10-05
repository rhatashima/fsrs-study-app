/** 学習日を表す "YYYY-MM-DD"（端末のローカル時刻基準） */
export type DayKey = string

/** 学習日の区切り（初期値 4 時：深夜 0〜4 時の学習は前日分に数える） */
export const DEFAULT_DAY_START_HOUR = 4

/**
 * 日時が属する学習日。dayStartHour 時より前は前日として扱う。
 * 例（4 時区切り）：2026-10-06 03:00 → "2026-10-05"、2026-10-06 04:01 → "2026-10-06"
 */
export function toDayKey(date: Date, dayStartHour: number = DEFAULT_DAY_START_HOUR): DayKey {
  const shifted = new Date(date.getTime())
  shifted.setHours(shifted.getHours() - dayStartHour)
  const y = shifted.getFullYear()
  const m = String(shifted.getMonth() + 1).padStart(2, '0')
  const d = String(shifted.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

/**
 * 現在の学習日が終わる日時（次の区切り時刻）。
 * 例（4 時区切り）：2026-10-06 03:00 → 2026-10-06 04:00、2026-10-06 04:01 → 2026-10-07 04:00
 */
export function studyDayEnd(now: Date, dayStartHour: number = DEFAULT_DAY_START_HOUR): Date {
  const boundary = new Date(now.getFullYear(), now.getMonth(), now.getDate(), dayStartHour, 0, 0, 0)
  if (boundary.getTime() <= now.getTime()) {
    boundary.setDate(boundary.getDate() + 1)
  }
  return boundary
}
