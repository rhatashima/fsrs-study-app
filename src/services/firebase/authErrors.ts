import { AppError } from '../../domain'

/** Firebase Authentication のエラーを、利用者に見せる日本語の AppError に変換する */
export function toAuthAppError(error: unknown): AppError {
  if (error instanceof AppError) return error
  const code = errorCode(error)
  const cause = { cause: error }
  switch (code) {
    case 'auth/popup-closed-by-user':
    case 'auth/cancelled-popup-request':
    case 'auth/user-cancelled':
      return new AppError('cancelled', 'ログインを取り消しました。', cause)
    case 'auth/popup-blocked':
      return new AppError(
        'popup-blocked',
        'ログイン画面のポップアップがブロックされました。ブラウザでポップアップを許可してから、もう一度お試しください。',
        cause,
      )
    case 'auth/network-request-failed':
      return new AppError('network', 'ネットワークに接続できませんでした。接続を確認して、もう一度お試しください。', cause)
    case 'auth/unauthorized-domain':
      return new AppError(
        'configuration',
        'このアドレスからのログインは許可されていません。Firebase コンソールの Authentication → 設定 → 承認済みドメイン を確認してください。',
        cause,
      )
    case 'auth/operation-not-allowed':
      return new AppError(
        'configuration',
        'Google ログインが有効になっていません。Firebase コンソールの Authentication で Google を有効にしてください。',
        cause,
      )
    case 'auth/invalid-api-key':
      return new AppError('configuration', 'Firebase の設定（API キー）が正しくありません。.env.local を確認してください。', cause)
    case 'auth/too-many-requests':
      return new AppError('network', 'ログインの試行が多すぎます。しばらく時間をおいてからお試しください。', cause)
    default:
      if (code?.startsWith('auth/api-key-not-valid')) {
        return new AppError('configuration', 'Firebase の設定（API キー）が正しくありません。.env.local を確認してください。', cause)
      }
      return new AppError('unknown', 'ログインに失敗しました。もう一度お試しください。', cause)
  }
}

function errorCode(error: unknown): string | null {
  if (typeof error === 'object' && error !== null && 'code' in error) {
    return typeof error.code === 'string' ? error.code : null
  }
  return null
}
