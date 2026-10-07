import type { Card } from '../../domain'
import type { Repositories } from '../../repositories/types'
import { IMPORT_FIELDS, type ImportCardDto, type ImportField } from './types'

export type ImportAction = 'new' | 'update' | 'unchanged'

export interface PlannedCard {
  action: ImportAction
  rowLabel: string
  /** 保存する（update は既存カードに取り込み内容を重ねた）カード。unchanged は既存カードそのまま */
  card: Card
  /** update で変わる項目 */
  changedFields: ImportField[]
}

export interface ImportCounts {
  new: number
  update: number
  unchanged: number
  total: number
}

/** 取り込みの予定（プレビュー）。まだ何も保存していない */
export interface ImportPlan {
  materialId: string
  items: PlannedCard[]
  counts: ImportCounts
}

function sameValue(a: unknown, b: unknown): boolean {
  if (Array.isArray(a) || Array.isArray(b)) {
    return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((x, i) => x === b[i])
  }
  return a === b
}

/** 既存カードに、ファイルに含まれていた項目だけを重ねる（含まれていない項目は元の値を残す） */
function mergeIntoExisting(existing: Card, row: ImportCardDto): { card: Card; changedFields: ImportField[] } {
  const card: Card = { ...existing, question: row.question, answer: row.answer }
  for (const field of row.provided) {
    const value = row[field]
    if (field === 'explanation' || field === 'category') card[field] = (value as string | undefined) ?? ''
    else if (field === 'tags') card.tags = (value as string[] | undefined) ?? []
    else if (field === 'order') {
      if (value !== undefined) card.order = value as number
    } else if (value === undefined) delete card[field]
    else Object.assign(card, { [field]: value })
  }
  const changedFields = IMPORT_FIELDS.filter((field) => !sameValue(existing[field], card[field]))
  return { card, changedFields }
}

/**
 * 取り込み内容と既存カードを比べて、新規・更新・変更なしに分ける（純粋関数）。
 * - 新規：order がなければ、教材内の最大値（とファイル内で指定された order の最大値）の後ろに、ファイルの順で採番。
 *   作成・更新日時は取り込み時刻、アーカイブなし
 * - 既存：ファイルに含まれていた項目だけを更新（order がなければ元の並び順のまま）。
 *   内容が同じなら変更なし（更新日時も変えない）。作成日時・アーカイブの状態は変えない
 * カードだけを扱い、学習状態（ReviewState）・学習履歴（ReviewLog）には関係しない。
 */
export function diffImport(params: {
  materialId: string
  rows: readonly ImportCardDto[]
  existing: ReadonlyMap<string, Card>
  maxOrder: number
  now: Date
}): ImportPlan {
  const { materialId, rows, existing, now } = params
  let nextOrder = Math.max(params.maxOrder, ...rows.map((row) => row.order ?? 0))
  const items: PlannedCard[] = rows.map((row) => {
    const current = existing.get(row.id)
    if (current) {
      const { card, changedFields } = mergeIntoExisting(current, row)
      return changedFields.length === 0
        ? { action: 'unchanged', rowLabel: row.rowLabel, card: current, changedFields }
        : { action: 'update', rowLabel: row.rowLabel, card: { ...card, updatedAt: now }, changedFields }
    }
    const card: Card = {
      id: row.id,
      materialId,
      question: row.question,
      answer: row.answer,
      explanation: row.explanation ?? '',
      category: row.category ?? '',
      tags: row.tags ?? [],
      order: row.order ?? (nextOrder += 1),
      isArchived: false,
      createdAt: now,
      updatedAt: now,
    }
    for (const key of ['subcategory', 'examDifficulty', 'importance', 'imageUrl', 'source', 'notes'] as const) {
      if (row[key] !== undefined) Object.assign(card, { [key]: row[key] })
    }
    return { action: 'new', rowLabel: row.rowLabel, card, changedFields: [] }
  })
  const count = (action: ImportAction) => items.filter((item) => item.action === action).length
  return {
    materialId,
    items,
    counts: { new: count('new'), update: count('update'), unchanged: count('unchanged'), total: items.length },
  }
}

/** 既存カード（ファイル内の id の分だけ）と、教材内の order の最大値を読んで、取り込みの予定を作る */
export async function planImport(
  repos: Repositories,
  materialId: string,
  rows: readonly ImportCardDto[],
  now: Date,
): Promise<ImportPlan> {
  const [existingCards, maxOrder] = await Promise.all([
    repos.cards.getByIds(
      materialId,
      rows.map((row) => row.id),
    ),
    repos.cards.getMaxOrder(materialId),
  ])
  return diffImport({
    materialId,
    rows,
    existing: new Map(existingCards.map((card) => [card.id, card])),
    maxOrder,
    now,
  })
}
