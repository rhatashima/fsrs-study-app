import type { AppUser } from './types'

/**
 * ログイン中の利用者が、このアプリの利用を許可された Owner か。
 * これは画面上の制御（UX）であり、セキュリティの境界ではない。
 * データの保護は Firestore Security Rules（Phase 5）で行う。
 */
export function isOwner(user: AppUser, ownerUid: string | null): boolean {
  return ownerUid !== null && ownerUid !== '' && user.uid === ownerUid
}
