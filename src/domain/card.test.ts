// @vitest-environment node
import { describe, expect, expectTypeOf, it } from 'vitest'
import { categoryLabel, isLevel, isValidCardId, type Card, type Level } from './card'
import type { ReviewState } from './review'

describe('Card の難易度と FSRS の難易度は別物', () => {
  // 型レベルの確認（tsc で検査される。実行時には何もしない）
  it('Card は difficulty を持たず、問題の難易度は examDifficulty（1〜5 または未指定）', () => {
    expectTypeOf<Card>().not.toHaveProperty('difficulty')
    expectTypeOf<Card['examDifficulty']>().toEqualTypeOf<Level | undefined>()
  })

  it('FSRS の difficulty は ReviewState にあり、Card の項目を持たない', () => {
    expectTypeOf<ReviewState['difficulty']>().toEqualTypeOf<number>()
    expectTypeOf<ReviewState>().not.toHaveProperty('examDifficulty')
    expectTypeOf<ReviewState>().not.toHaveProperty('question')
  })

  it('Card は学習状態（FSRS の値・評価回数）を持たない', () => {
    expectTypeOf<Card>().not.toHaveProperty('due')
    expectTypeOf<Card>().not.toHaveProperty('stability')
    expectTypeOf<Card>().not.toHaveProperty('ratingCounts')
  })
})

describe('isLevel', () => {
  it.each([1, 2, 3, 4, 5])('%s は有効', (value) => {
    expect(isLevel(value)).toBe(true)
  })
  it.each([0, 6, 2.5, '3', null, undefined, Number.NaN])('%s は無効', (value) => {
    expect(isLevel(value)).toBe(false)
  })
})

describe('isValidCardId', () => {
  it.each(['castle-001', 'A_b-9', 'x'.repeat(100)])('%s は有効', (id) => {
    expect(isValidCardId(id)).toBe(true)
  })
  it.each(['', 'a/b', 'a.b', '城-1', 'has space', '__x__.', 'x'.repeat(101)])('%s は無効', (id) => {
    expect(isValidCardId(id)).toBe(false)
  })
})

describe('categoryLabel', () => {
  it('空白だけのカテゴリーは「未分類」', () => {
    expect(categoryLabel({ category: '  ' })).toBe('未分類')
  })
  it('前後の空白を除く', () => {
    expect(categoryLabel({ category: ' 石垣 ' })).toBe('石垣')
  })
})
