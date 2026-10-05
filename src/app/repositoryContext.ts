import { createContext, useContext } from 'react'
import type { Repositories } from '../repositories/types'

export const RepositoryContext = createContext<Repositories | null>(null)

/** 画面からデータ層を使うためのフック。実装（メモリ / Firestore）は main.tsx で選ぶ。 */
export function useRepositories(): Repositories {
  const repositories = useContext(RepositoryContext)
  if (!repositories) {
    throw new Error('RepositoryContext.Provider が設定されていません')
  }
  return repositories
}
