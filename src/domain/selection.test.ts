// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { hoursAfter, makeCard, makeState, T0 } from '../test/factories'
import { selectDueStates, selectNewCards } from './selection'

describe('selectNewCards（新規カードの取り出し）', () => {
  const cards = [
    makeCard({ id: 'c3', order: 3 }),
    makeCard({ id: 'c1', order: 1 }),
    makeCard({ id: 'c4', order: 4, isArchived: true }),
    makeCard({ id: 'c2', order: 2 }),
    makeCard({ id: 'c5', order: 5 }),
    makeCard({ id: 'other', order: 1, materialId: 'm2' }),
  ]
  const ids = (list: { id: string }[]) => list.map((c) => c.id)

  it('order 順に並べ、指定教材のカードだけを返す', () => {
    expect(ids(selectNewCards(cards, { materialId: 'm1', afterOrder: 0, limit: 10 }))).toEqual([
      'c1',
      'c2',
      'c3',
      'c5',
    ])
  })

  it('アーカイブ済みのカードを除く', () => {
    expect(ids(selectNewCards(cards, { materialId: 'm1', afterOrder: 3, limit: 10 }))).toEqual(['c5'])
  })

  it('afterOrder 以下（導入検討済み）のカードを除き、limit 件まで返す', () => {
    expect(ids(selectNewCards(cards, { materialId: 'm1', afterOrder: 1, limit: 2 }))).toEqual(['c2', 'c3'])
  })

  it('学習済み（ReviewState がある）カードを除く', () => {
    const studied = new Set(['c1', 'c3'])
    expect(
      ids(selectNewCards(cards, { materialId: 'm1', afterOrder: 0, limit: 10, studiedCardIds: studied })),
    ).toEqual(['c2', 'c5'])
  })

  it('limit が 0 以下なら空', () => {
    expect(selectNewCards(cards, { materialId: 'm1', afterOrder: 0, limit: 0 })).toEqual([])
  })

  it('order が同じなら id 順（取り出し順が毎回変わらない）', () => {
    const tie = [makeCard({ id: 'b', order: 1 }), makeCard({ id: 'a', order: 1 })]
    expect(ids(selectNewCards(tie, { materialId: 'm1', afterOrder: 0, limit: 10 }))).toEqual(['a', 'b'])
  })
})

describe('selectDueStates（期限が指定日時より前のカードの取り出し）', () => {
  const dueBefore = hoursAfter(T0, 48)
  const states = [
    makeState({ cardId: 'late', due: hoursAfter(T0, 40) }),
    makeState({ cardId: 'early', due: hoursAfter(T0, 10) }),
    makeState({ cardId: 'boundary', due: dueBefore }),
    makeState({ cardId: 'future', due: hoursAfter(T0, 50) }),
    makeState({ cardId: 'suspended', due: hoursAfter(T0, 1), suspended: true }),
    makeState({ cardId: 'other', due: hoursAfter(T0, 1), materialId: 'm2' }),
  ]

  it('期限の早い順に返す（境界ちょうど・未来・一時停止・他教材は除く）', () => {
    expect(selectDueStates(states, { materialId: 'm1', dueBefore }).map((s) => s.cardId)).toEqual([
      'early',
      'late',
    ])
  })

  it('limit 件まで返す', () => {
    expect(
      selectDueStates(states, { materialId: 'm1', dueBefore, limit: 1 }).map((s) => s.cardId),
    ).toEqual(['early'])
  })
})
