// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { hoursAfter, makeSnapshot, makeState, T0 } from '../test/factories'
import { isDue, isFirstReview, isUnstudied } from './review'

describe('isUnstudied（未学習判定）', () => {
  it('ReviewState がなければ未学習', () => {
    expect(isUnstudied(undefined)).toBe(true)
  })
  it('ReviewState があれば学習済み', () => {
    expect(isUnstudied(makeState({ cardId: 'c1' }))).toBe(false)
  })
})

describe('isDue（期限到来判定）', () => {
  const due = hoursAfter(T0, 24)

  it('期限ちょうどは期限到来', () => {
    expect(isDue(makeState({ cardId: 'c1', due }), due)).toBe(true)
  })
  it('期限を過ぎていれば期限到来', () => {
    expect(isDue(makeState({ cardId: 'c1', due }), hoursAfter(due, 1))).toBe(true)
  })
  it('期限前は対象外', () => {
    expect(isDue(makeState({ cardId: 'c1', due }), hoursAfter(due, -1))).toBe(false)
  })
  it('一時停止中のカードは期限を過ぎていても対象外', () => {
    expect(isDue(makeState({ cardId: 'c1', due, suspended: true }), hoursAfter(due, 1))).toBe(false)
  })
})

describe('isFirstReview', () => {
  it('previousState が null なら初回レビュー', () => {
    expect(isFirstReview({ previousState: null })).toBe(true)
    expect(isFirstReview({ previousState: makeSnapshot() })).toBe(false)
  })
})
