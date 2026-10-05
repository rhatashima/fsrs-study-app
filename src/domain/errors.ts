export type AppErrorKind =
  | 'not-found'
  | 'conflict'
  | 'invalid-data'
  | 'permission-denied'
  | 'network'
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
