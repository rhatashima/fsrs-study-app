import { getApp, getApps, initializeApp, type FirebaseApp } from 'firebase/app'
import type { FirebaseWebConfig } from './config'

/**
 * Firebase アプリの初期化（アプリ全体で 1 回だけ）。
 * テストではこの関数を呼ばず、AuthGateway の偽物を使う（Firebase と通信しない）。
 */
export function getFirebaseApp(config: FirebaseWebConfig): FirebaseApp {
  return getApps().length > 0 ? getApp() : initializeApp(config)
}
