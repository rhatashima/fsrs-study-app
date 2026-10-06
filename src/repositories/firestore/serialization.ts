import { Timestamp, type DocumentData } from 'firebase/firestore'

/*
 * Firestore との値の変換（リポジトリの境界）。アプリ内は Date、Firestore では Timestamp。
 */

/** アプリの値 → Firestore に保存する値（Date → Timestamp、undefined の項目は省く） */
export function toFirestoreValue(value: unknown): unknown {
  if (value instanceof Date) return Timestamp.fromDate(value)
  if (Array.isArray(value)) return value.map(toFirestoreValue)
  if (value !== null && typeof value === 'object') {
    const result: Record<string, unknown> = {}
    for (const [key, item] of Object.entries(value)) {
      if (item !== undefined) result[key] = toFirestoreValue(item)
    }
    return result
  }
  return value
}

export function toFirestoreData(value: object): DocumentData {
  return toFirestoreValue(value) as DocumentData
}

/** Firestore から読んだ値 → Date（Timestamp 以外は null） */
export function toDate(value: unknown): Date | null {
  if (value instanceof Timestamp) return value.toDate()
  // 別のインスタンスの Timestamp（テスト環境など）にも対応する
  if (
    value !== null &&
    typeof value === 'object' &&
    'toDate' in value &&
    typeof value.toDate === 'function' &&
    'seconds' in value
  ) {
    const date: unknown = (value as { toDate: () => unknown }).toDate()
    return date instanceof Date && !Number.isNaN(date.getTime()) ? date : null
  }
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value
  return null
}
