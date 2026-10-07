import { rebuildProgress } from '../../domain'
import { errorMessage } from '../../lib/errorMessage'
import type { Repositories } from '../../repositories/types'
import type { ImportPlan, PlannedCard } from './plan'

/** 1 回の一括書き込みで保存するカードの数（Firestore の上限 500 件に余裕を残す） */
export const IMPORT_CHUNK_SIZE = 400

export interface ImportResult {
  /** 保存できた新規カード */
  new: number
  /** 保存できた更新カード */
  update: number
  unchanged: number
  /** 保存できなかった（新規・更新の）カード */
  failed: number
  total: number
  /** カードの保存に失敗したときのメッセージ（途中まで保存された場合を含む） */
  error: string | null
  /** 集計を作り直せたか（カードの保存がすべて成功したときだけ作り直す） */
  progressRebuilt: boolean
  /** 集計の作り直しに失敗したときのメッセージ */
  progressError: string | null
}

/**
 * 教材の集計（MaterialProgress）を、すべてのカードと学習状態から作り直す。
 * 日別の記録と最終学習日時は、既存の集計から引き継ぐ。全件を読むため、インポート後と手動の再集計でだけ使う。
 */
export async function rebuildMaterialProgress(repos: Repositories, materialId: string, now: Date): Promise<void> {
  const [cards, states, previous] = await Promise.all([
    repos.cards.listAll(materialId),
    repos.reviews.listAllStates(materialId),
    repos.reviews.getProgress(materialId),
  ])
  await repos.reviews.replaceProgress(rebuildProgress({ materialId, cards, states, previous, now }))
}

/**
 * 取り込みを実行する。
 * - 新規・更新のカードだけを、IMPORT_CHUNK_SIZE 件ずつ順番に保存する（変更なしは書かない）
 * - 途中で失敗したら止める。保存済みの分は戻さない。同じファイルをもう一度取り込むと、
 *   保存済みの分は「変更なし」になり、残りだけが保存される（冪等）
 * - すべて保存できたら、集計を全件から作り直す（失敗してもカードは戻さない。手動で作り直せる）
 * 学習状態（ReviewState）・学習履歴（ReviewLog）には触れない。
 */
export async function executeImport(
  repos: Repositories,
  plan: ImportPlan,
  options: { now: Date; chunkSize?: number; onProgress?: (done: number, total: number) => void },
): Promise<ImportResult> {
  const chunkSize = options.chunkSize ?? IMPORT_CHUNK_SIZE
  const writes = plan.items.filter((item) => item.action !== 'unchanged')
  const result: ImportResult = {
    new: 0,
    update: 0,
    unchanged: plan.counts.unchanged,
    failed: 0,
    total: plan.counts.total,
    error: null,
    progressRebuilt: false,
    progressError: null,
  }

  let done = 0
  options.onProgress?.(0, writes.length)
  for (let start = 0; start < writes.length; start += chunkSize) {
    const chunk: PlannedCard[] = writes.slice(start, start + chunkSize)
    try {
      await repos.cards.saveMany(chunk.map((item) => item.card))
    } catch (error) {
      result.failed = writes.length - done
      result.error = errorMessage(error, 'カードを保存できませんでした。')
      return result
    }
    for (const item of chunk) {
      if (item.action === 'new') result.new += 1
      else result.update += 1
    }
    done += chunk.length
    options.onProgress?.(done, writes.length)
  }

  if (writes.length === 0) return { ...result, progressRebuilt: true }
  try {
    await rebuildMaterialProgress(repos, plan.materialId, options.now)
    result.progressRebuilt = true
  } catch (error) {
    result.progressError = errorMessage(error, '集計を作り直せませんでした。')
  }
  return result
}
