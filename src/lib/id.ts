const ALPHABET = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ'

/**
 * ランダムな id（20 文字、英数字）。ReviewLog の id などに使う。
 * crypto.randomUUID は https / localhost でしか使えないため、
 * スマホから LAN 経由（http）で開発サーバーに接続した場合でも動く getRandomValues を使う。
 */
export function createId(length = 20): string {
  const bytes = crypto.getRandomValues(new Uint8Array(length))
  let id = ''
  for (const byte of bytes) id += ALPHABET[byte % ALPHABET.length]
  return id
}
