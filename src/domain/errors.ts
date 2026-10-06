export type AppErrorKind =
  | 'not-found'
  | 'conflict'
  | 'invalid-data'
  /** 学習状態（ReviewState）が壊れている・見つからない（履歴から復元できる） */
  | 'corrupted-data'
  | 'permission-denied'
  /** ログインが切れている */
  | 'unauthenticated'
  | 'network'
  /** 利用者が操作を取り消した（ログインのポップアップを閉じたなど）。エラー表示は不要 */
  | 'cancelled'
  /** ブラウザがポップアップをブロックした */
  | 'popup-blocked'
  /** 設定（環境変数・Firebase コンソール）の不足や誤り */
  | 'configuration'
  | 'unknown'

/** 利用者に見せる日本語メッセージ付きのエラー。外部ライブラリのエラーはリポジトリ層でこれに変換する。 */
export class AppError extends Error {
  readonly kind: AppErrorKind

  constructor(kind: AppErrorKind, message: string, options?: { cause?: unknown }) {
    super(message, options)
    this.name = 'AppError'
    this.kind = kind
  }
}

export function isAppError(error: unknown): error is AppError {
  return error instanceof AppError
}

/**
 * 学習状態（ReviewState）が壊れている、または ReviewLog があるのに ReviewState がない。
 * 黙って書き換えず、利用者に知らせて「履歴から復元」を選んでもらうためのエラー。
 */
export class CorruptedReviewStateError extends AppError {
  readonly materialId: string
  readonly cardIds: readonly string[]

  constructor(materialId: string, cardIds: readonly string[], options?: { cause?: unknown }) {
    super(
      'corrupted-data',
      `学習データの一部（${cardIds.length} 枚分）が壊れているか見つかりません。学習履歴から復元できます。`,
      options,
    )
    this.name = 'CorruptedReviewStateError'
    this.materialId = materialId
    this.cardIds = cardIds
  }
}

export function isCorruptedReviewStateError(error: unknown): error is CorruptedReviewStateError {
  return error instanceof CorruptedReviewStateError
}
