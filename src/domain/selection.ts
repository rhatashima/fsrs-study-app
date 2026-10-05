import type { Card } from './card'
import { isDue, type ReviewState } from './review'

export function belongsToMaterial<T extends { materialId: string }>(item: T, materialId: string): boolean {
  return item.materialId === materialId
}

/**
 * 新規カードの候補を order 順に取り出す。
 * - アーカイブ済みと、order が afterOrder 以下（導入検討済み）のカードは除く
 * - studiedCardIds に含まれる（ReviewState がある）カードは除く
 */
export function selectNewCards(
  cards: readonly Card[],
  options: { materialId: string; afterOrder: number; limit: number; studiedCardIds?: ReadonlySet<string> },
): Card[] {
  const { materialId, afterOrder, limit, studiedCardIds } = options
  if (limit <= 0) return []
  return cards
    .filter(
      (card) =>
        belongsToMaterial(card, materialId) &&
        !card.isArchived &&
        card.order > afterOrder &&
        !studiedCardIds?.has(card.id),
    )
    .sort((a, b) => a.order - b.order || a.id.localeCompare(b.id))
    .slice(0, limit)
}

/** 期限が来た ReviewState を期限の早い順に取り出す */
export function selectDueStates(
  states: readonly ReviewState[],
  options: { materialId: string; now: Date; limit?: number },
): ReviewState[] {
  const { materialId, now, limit } = options
  const due = states
    .filter((state) => belongsToMaterial(state, materialId) && isDue(state, now))
    .sort((a, b) => a.due.getTime() - b.due.getTime() || a.cardId.localeCompare(b.cardId))
  return limit === undefined ? due : due.slice(0, Math.max(0, limit))
}
