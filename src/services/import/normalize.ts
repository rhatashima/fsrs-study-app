import { isLevel, isValidCardId, type Level } from '../../domain'
import type { ImportCardDto, ImportField, ImportIssue } from './types'

/** ファイルで使える項目名（`difficulty` は `examDifficulty` の別名として受け付ける） */
export const KNOWN_KEYS = new Set([
  'id',
  'materialId',
  'question',
  'answer',
  'explanation',
  'category',
  'subcategory',
  'tags',
  'examDifficulty',
  'difficulty',
  'importance',
  'imageUrl',
  'source',
  'notes',
  'order',
])

const MAX_ORDER = 1_000_000_000

/**
 * ファイルの 1 件（CSV の 1 行・JSON の 1 オブジェクト）を、取り込み用の 1 件に正規化・検証する。
 * - 文字列は前後の空白を除く
 * - `difficulty` は `examDifficulty` にする（両方あればエラー）
 * - tags は `;` 区切り（JSON は配列も可）。空のタグと重複を除く
 * - 含まれていない項目（キーがない・CSV の列がない）は provided に入れない
 */
export function normalizeRecord(
  raw: Record<string, unknown>,
  where: string,
  selectedMaterialId: string,
): { dto: ImportCardDto | null; errors: ImportIssue[] } {
  const errors: ImportIssue[] = []
  const fail = (message: string) => {
    errors.push({ where, message })
  }
  const provided = new Set<ImportField>()

  /** 文字列として読む（undefined = 項目なし、'' = 空） */
  const text = (key: string): string | undefined => {
    const value = raw[key]
    if (value === undefined) return undefined
    if (value === null) return ''
    if (typeof value === 'string') return value.trim()
    if (typeof value === 'number' || typeof value === 'boolean') return String(value)
    fail(`${key} は文字列で指定してください。`)
    return undefined
  }

  const id = text('id') ?? ''
  if (id === '') fail('id が空です。')
  else if (!isValidCardId(id)) {
    fail(`id「${id}」は使えません。半角英数字・ハイフン・アンダースコア（100 文字以内）で指定してください。`)
  }

  const question = text('question') ?? ''
  if (question === '') fail('問題（question）が空です。')
  const answer = text('answer') ?? ''
  if (answer === '') fail('答え（answer）が空です。')

  const materialId = text('materialId')
  if (materialId !== undefined && materialId !== '' && materialId !== selectedMaterialId) {
    fail(`教材（materialId「${materialId}」）が、選んだ教材と違います。別の教材のファイルではないか確認してください。`)
  }

  const dto: ImportCardDto = { rowLabel: where, id, question, answer, provided }

  // 解説・カテゴリー：空でもよい（空なら空にする）
  for (const key of ['explanation', 'category'] as const) {
    const value = text(key)
    if (value !== undefined) {
      provided.add(key)
      dto[key] = value
    }
  }
  // 任意の文字列：空なら値なし
  for (const key of ['subcategory', 'source', 'notes'] as const) {
    const value = text(key)
    if (value !== undefined) {
      provided.add(key)
      if (value !== '') dto[key] = value
    }
  }

  const imageUrl = text('imageUrl')
  if (imageUrl !== undefined) {
    provided.add('imageUrl')
    if (imageUrl !== '') {
      if (imageUrl.startsWith('https://') || imageUrl.startsWith('/')) dto.imageUrl = imageUrl
      else fail(`画像（imageUrl「${imageUrl}」）は https:// で始まる URL か、/ で始まるパスで指定してください。`)
    }
  }

  const tags = readTags(raw['tags'], fail)
  if (tags !== undefined) {
    provided.add('tags')
    dto.tags = tags
  }

  // 問題の難易度：正式な名前は examDifficulty。difficulty は別名（両方はあいまいなのでエラー）
  if (raw['examDifficulty'] !== undefined && raw['difficulty'] !== undefined) {
    fail('examDifficulty と difficulty の両方があります。どちらか一方（examDifficulty）だけにしてください。')
  } else {
    const key = raw['examDifficulty'] !== undefined ? 'examDifficulty' : 'difficulty'
    const level = readLevel(raw[key], `問題の難易度（${key}）`, fail)
    if (level !== undefined) {
      provided.add('examDifficulty')
      if (level !== null) dto.examDifficulty = level
    }
  }

  const importance = readLevel(raw['importance'], '重要度（importance）', fail)
  if (importance !== undefined) {
    provided.add('importance')
    if (importance !== null) dto.importance = importance
  }

  // 並び順：空なら指定なし（新規は末尾に追加・既存はそのまま）
  const orderText = text('order')
  if (orderText !== undefined && orderText !== '') {
    const order = Number(orderText)
    if (!/^\d+$/.test(orderText) || !Number.isSafeInteger(order) || order < 1 || order > MAX_ORDER) {
      fail(`並び順（order「${orderText}」）は 1 以上の整数で指定してください。`)
    } else {
      provided.add('order')
      dto.order = order
    }
  }

  return { dto: errors.length === 0 ? dto : null, errors }
}

/** tags：CSV は `;` 区切りの文字列、JSON は文字列の配列も可。前後の空白・空のタグ・重複を除く */
function readTags(value: unknown, fail: (message: string) => void): string[] | undefined {
  if (value === undefined) return undefined
  if (value === null) return []
  let parts: unknown[]
  if (typeof value === 'string') parts = value.split(';')
  else if (Array.isArray(value)) parts = value
  else {
    fail('タグ（tags）は「;」区切りの文字列か、文字列の配列で指定してください。')
    return undefined
  }
  if (!parts.every((part) => typeof part === 'string')) {
    fail('タグ（tags）は文字列で指定してください。')
    return undefined
  }
  return [...new Set(parts.map((tag) => tag.trim()).filter((tag) => tag !== ''))]
}

/** 1〜5 の整数（undefined = 項目なし、null = 空） */
function readLevel(value: unknown, label: string, fail: (message: string) => void): Level | null | undefined {
  if (value === undefined) return undefined
  if (value === null || (typeof value === 'string' && value.trim() === '')) return null
  const number = typeof value === 'number' ? value : typeof value === 'string' ? Number(value.trim()) : Number.NaN
  if (isLevel(number)) return number
  fail(`${label}は 1〜5 の整数で指定してください（値：${typeof value === 'string' || typeof value === 'number' ? value : JSON.stringify(value)}）。`)
  return undefined
}
