import type { FirebaseApp } from 'firebase/app'
import { getFirestore, initializeFirestore, type Firestore } from 'firebase/firestore'

let db: Firestore | null = null

/**
 * Cloud Firestore の初期化（アプリ全体で 1 回だけ）。
 * - オフラインの永続キャッシュは使わない（docs/ARCHITECTURE.md「同期・保存方針」）
 * - undefined の項目は保存しない
 */
export function getFirestoreDb(app: FirebaseApp): Firestore {
  if (db) return db
  try {
    db = initializeFirestore(app, { ignoreUndefinedProperties: true })
  } catch {
    // 開発サーバーの再読み込みなどで、すでに初期化されている場合
    db = getFirestore(app)
  }
  return db
}
