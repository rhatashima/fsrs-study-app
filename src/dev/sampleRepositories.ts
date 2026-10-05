import { createMemoryRepositories } from '../repositories/memory/createMemoryRepositories'
import type { Repositories } from '../repositories/types'
import { SAMPLE_CARDS, SAMPLE_MATERIALS } from './sampleData'

/** ダミーデータ入りのメモリ上のリポジトリ（Firestore 接続までの開発用） */
export function createSampleRepositories(): Repositories {
  return createMemoryRepositories({ materials: SAMPLE_MATERIALS, cards: SAMPLE_CARDS })
}
