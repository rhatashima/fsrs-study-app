import { rebuildProgress } from '../domain'
import { SAMPLE_CARDS, SAMPLE_MATERIALS } from '../dev/sampleData'
import type { Repositories } from '../repositories/types'

/**
 * 開発用：ダミーデータ（src/dev/sampleData.ts）をリポジトリに入れる。開発サーバーでだけ使う。
 * - 教材・カードは作成または上書き（内容のみ）。学習状態・学習履歴には触れない
 * - 集計は、既存の学習状態と日別記録を引き継いで作り直す
 */
export async function seedSampleData(repos: Repositories, now: Date): Promise<{ materials: number; cards: number }> {
  for (const material of SAMPLE_MATERIALS) {
    const existing = await repos.materials.get(material.id)
    await repos.materials.save(existing ? { ...material, createdAt: existing.createdAt, updatedAt: now } : material)
  }
  await repos.cards.saveMany(SAMPLE_CARDS)
  for (const material of SAMPLE_MATERIALS) {
    const cards = SAMPLE_CARDS.filter((card) => card.materialId === material.id)
    const states = await repos.reviews.getStates(
      material.id,
      cards.map((card) => card.id),
    )
    const previous = await repos.reviews.getProgress(material.id)
    await repos.reviews.replaceProgress(rebuildProgress({ materialId: material.id, cards, states, previous, now }))
  }
  return { materials: SAMPLE_MATERIALS.length, cards: SAMPLE_CARDS.length }
}
