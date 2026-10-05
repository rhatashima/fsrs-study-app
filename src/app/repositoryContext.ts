import { createContext, useContext } from 'react'
import type { Repositories } from '../repositories/types'
import type { AppUser } from '../services/auth/types'

export const RepositoryContext = createContext<Repositories | null>(null)

/** 画面からデータ層を使うためのフック。Owner としてログインしている間だけ使える。 */
export function useRepositories(): Repositories {
  const repositories = useContext(RepositoryContext)
  if (!repositories) {
    throw new Error('RepositoryContext.Provider が設定されていません')
  }
  return repositories
}

/**
 * ログインした利用者ごとにデータ層を作る関数（main.tsx で選ぶ）。
 * Phase 4 まではメモリ上のダミーデータ、Phase 5 から Firestore（users/{uid}/...）。
 */
export type RepositoryFactory = (user: AppUser) => Repositories

export const RepositoryFactoryContext = createContext<RepositoryFactory | null>(null)
