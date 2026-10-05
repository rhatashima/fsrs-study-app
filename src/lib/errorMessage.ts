import { isAppError } from '../domain'

/** 利用者に見せる日本語のエラーメッセージ（AppError 以外は fallback） */
export function errorMessage(error: unknown, fallback: string): string {
  return isAppError(error) ? error.message : fallback
}
