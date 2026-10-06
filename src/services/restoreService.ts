import { restoreStateFromLogs } from '../domain'
import type { Repositories } from '../repositories/types'

/** 1 枚のカードの履歴として読む上限（通常の利用で超えることはない） */
const MAX_LOGS_PER_CARD = 1000

export interface RestoreResult {
  /** 復元できたカード */
  restored: string[]
  /** 有効な履歴がない・保存に失敗したなどで復元できなかったカード */
  failed: string[]
}

/**
 * 壊れた・見つからない ReviewState を学習履歴から復元する（利用者が「復元する」を選んだときだけ呼ぶ）。
 * 再計算はせず、各カードの最新の有効な ReviewLog の nextState を使う（domain の restoreStateFromLogs）。
 * ReviewLog と集計は変更しない。
 */
export async function restoreReviewStates(
  repos: Repositories,
  materialId: string,
  cardIds: readonly string[],
  now: Date,
): Promise<RestoreResult> {
  const cards = new Map((await repos.cards.getByIds(materialId, cardIds)).map((card) => [card.id, card]))
  const result: RestoreResult = { restored: [], failed: [] }
  for (const cardId of cardIds) {
    try {
      const logs = await repos.reviews.listLogsForCard(materialId, cardId, { limit: MAX_LOGS_PER_CARD })
      const state = restoreStateFromLogs(logs, { suspended: cards.get(cardId)?.isArchived ?? false, now })
      if (!state) {
        result.failed.push(cardId)
        continue
      }
      await repos.reviews.restoreState(state)
      result.restored.push(cardId)
    } catch {
      result.failed.push(cardId)
    }
  }
  return result
}
