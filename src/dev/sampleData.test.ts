import { describe, expect, it } from 'vitest'
import { categoryLabel, isLevel, isValidCardId } from '../domain'
import { createSampleRepositories } from './sampleRepositories'
import {
  SAMPLE_CARDS,
  SAMPLE_CASTLE_MATERIAL_ID,
  SAMPLE_MATERIALS,
  SAMPLE_TEST_MATERIAL_ID,
} from './sampleData'

// public/ 配下の実在する画像ファイル（ビルド時に解決される）
const PUBLIC_IMAGES = Object.keys(import.meta.glob('/public/images/**/*.svg')).map((path) =>
  path.replace(/^\/public/, ''),
)

describe('開発用ダミーデータ', () => {
  it('教材は「日本城郭検定3級」と「テスト用教材」', () => {
    expect(SAMPLE_MATERIALS.map((m) => m.title)).toEqual(['日本城郭検定3級', 'テスト用教材'])
  })

  it('カードは合計 20 枚程度', () => {
    expect(SAMPLE_CARDS.length).toBeGreaterThanOrEqual(18)
    expect(SAMPLE_CARDS.length).toBeLessThanOrEqual(25)
  })

  it('カード id は有効で、教材内で重複しない', () => {
    for (const card of SAMPLE_CARDS) expect(isValidCardId(card.id), card.id).toBe(true)
    const keys = SAMPLE_CARDS.map((c) => `${c.materialId}/${c.id}`)
    expect(new Set(keys).size).toBe(keys.length)
  })

  it('すべてのカードが存在する教材に属し、order は教材内で 1 からの連番', () => {
    for (const material of SAMPLE_MATERIALS) {
      const orders = SAMPLE_CARDS.filter((c) => c.materialId === material.id).map((c) => c.order)
      expect(orders).toEqual(orders.map((_, i) => i + 1))
    }
    const materialIds = new Set(SAMPLE_MATERIALS.map((m) => m.id))
    expect(SAMPLE_CARDS.every((c) => materialIds.has(c.materialId))).toBe(true)
  })

  it('問題の難易度・重要度は 1〜5 または未指定（実行時の値も確認）', () => {
    for (const card of SAMPLE_CARDS) {
      if (card.examDifficulty !== undefined) expect(isLevel(card.examDifficulty), card.id).toBe(true)
      if (card.importance !== undefined) expect(isLevel(card.importance), card.id).toBe(true)
      expect(card, card.id).not.toHaveProperty('difficulty')
    }
  })

  it('日本城郭検定3級は 5 つ以上のカテゴリーに分かれている', () => {
    const categories = new Set(
      SAMPLE_CARDS.filter((c) => c.materialId === SAMPLE_CASTLE_MATERIAL_ID).map(categoryLabel),
    )
    expect([...categories]).toEqual(expect.arrayContaining(['城郭用語', '縄張り', '石垣', '天守', '城郭史']))
  })

  it('画像付きカードが 2 枚以上あり、画像ファイルが public/images/ に実在する', () => {
    const withImage = SAMPLE_CARDS.filter((c) => c.imageUrl)
    expect(withImage.length).toBeGreaterThanOrEqual(2)
    for (const card of withImage) expect(PUBLIC_IMAGES, card.id).toContain(card.imageUrl)
  })

  it('メモリ上のリポジトリに読み込める', async () => {
    const repos = createSampleRepositories()
    expect(await repos.materials.list()).toHaveLength(2)
    expect((await repos.reviews.getProgress(SAMPLE_TEST_MATERIAL_ID)).totalCards).toBe(
      SAMPLE_CARDS.filter((c) => c.materialId === SAMPLE_TEST_MATERIAL_ID && !c.isArchived).length,
    )
  })
})
