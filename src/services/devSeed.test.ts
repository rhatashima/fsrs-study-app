// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { SAMPLE_CARDS, SAMPLE_CASTLE_MATERIAL_ID } from '../dev/sampleData'
import { createMemoryRepositories } from '../repositories/memory/createMemoryRepositories'
import { makeReviewRecord, T0 } from '../test/factories'
import { seedSampleData } from './devSeed'

describe('seedSampleData（開発用ダミーデータの投入）', () => {
  it('空のデータに教材・カード・集計を入れる', async () => {
    const repos = createMemoryRepositories({}, { clock: () => T0 })
    await seedSampleData(repos, T0)
    expect((await repos.materials.list()).map((m) => m.title).sort()).toEqual(['テスト用教材', '日本城郭検定3級'].sort())
    const castleCards = SAMPLE_CARDS.filter((c) => c.materialId === SAMPLE_CASTLE_MATERIAL_ID)
    expect(await repos.cards.countActive(SAMPLE_CASTLE_MATERIAL_ID)).toBe(castleCards.length)
    expect(await repos.reviews.getProgress(SAMPLE_CASTLE_MATERIAL_ID)).toMatchObject({
      totalCards: castleCards.length,
      studiedCards: 0,
    })
  })

  it('もう一度投入しても学習状態・学習履歴は変わらず、集計は学習済みを数えたまま', async () => {
    const repos = createMemoryRepositories({}, { clock: () => T0 })
    await seedSampleData(repos, T0)
    const record = makeReviewRecord({ cardId: 'castle-001', logId: 'l1', materialId: SAMPLE_CASTLE_MATERIAL_ID })
    await repos.reviews.recordReview(record)

    await seedSampleData(repos, T0)
    expect(await repos.reviews.getStates(SAMPLE_CASTLE_MATERIAL_ID, ['castle-001'])).toEqual([record.state])
    expect(await repos.reviews.listLogsForCard(SAMPLE_CASTLE_MATERIAL_ID, 'castle-001', { limit: 5 })).toHaveLength(1)
    const progress = await repos.reviews.getProgress(SAMPLE_CASTLE_MATERIAL_ID)
    expect(progress.studiedCards).toBe(1)
    expect(progress.daily['2026-10-01']).toEqual({ reviews: 1, newCards: 1 })
  })
})
