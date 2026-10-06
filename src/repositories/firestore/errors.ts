import { AppError } from '../../domain'

/**
 * Firestore のエラーを、利用者に見せる日本語の AppError に変換する
 * （Firebase のエラーコードはそのまま画面に出さない）。AppError はそのまま返す。
 */
export function toFirestoreAppError(error: unknown): AppError {
  if (error instanceof AppError) return error
  const cause = { cause: error }
  switch (errorCode(error)) {
    case 'permission-denied':
      return new AppError(
        'permission-denied',
        'データへのアクセスが拒否されました。利用を許可されたアカウントでログインしているか確認してください。',
        cause,
      )
    case 'unauthenticated':
      return new AppError('unauthenticated', 'ログインの有効期限が切れました。もう一度ログインしてください。', cause)
    case 'unavailable':
    case 'deadline-exceeded':
      return new AppError('network', 'サーバーに接続できませんでした。通信状態を確認して、もう一度お試しください。', cause)
    case 'aborted':
      return new AppError('conflict', '他の端末の更新と重なったため保存できませんでした。もう一度お試しください。', cause)
    case 'failed-precondition':
      return new AppError(
        'configuration',
        'データベースの設定（インデックスなど）が不足しています。設定を反映してから、もう一度お試しください。',
        cause,
      )
    case 'not-found':
      return new AppError('not-found', 'データが見つかりません。', cause)
    case 'resource-exhausted':
      return new AppError('network', '利用量の上限に達した可能性があります。時間をおいてから、もう一度お試しください。', cause)
    case 'invalid-argument':
      return new AppError('invalid-data', '保存できない形式のデータです。', cause)
    default:
      return new AppError('unknown', 'データの読み書きに失敗しました。もう一度お試しください。', cause)
  }
}

function errorCode(error: unknown): string | null {
  if (typeof error === 'object' && error !== null && 'code' in error) {
    return typeof error.code === 'string' ? error.code : null
  }
  return null
}

/** 処理を実行し、失敗したら日本語の AppError にして投げ直す */
export async function guard<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn()
  } catch (error) {
    throw toFirestoreAppError(error)
  }
}
