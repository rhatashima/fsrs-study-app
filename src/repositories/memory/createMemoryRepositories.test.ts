// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { AppError } from '../../domain'
import { makeCard, makeMaterial, makeReviewRecord, T0 } from '../../test/factories'
import { describeRepositoryContract } from '../repositoryContract'
import { createMemoryRepositories } from './createMemoryRepositories'

// Firestore 実装と同じ契約テスト
describeRepositoryContract('メモリ', () => Promise.resolve(createMemoryRepositories({}, { clock: () => T0 })))

describe('メモリ実装に固有の振る舞い', () => {
  function setup() {
    return createMemoryRepositories(
      {
        materials: [makeMaterial({ id: 'm1' })],
        cards: [makeCard({ id: 'c1', order: 1 }), makeCard({ id: 'c2', order: 2, isArchived: true })],
      },
      { clock: () => T0 },
    )
  }

  it('初期データから集計を作る（アーカイブ除く）', async () => {
    const repos = setup()
    expect(await repos.reviews.getProgress('m1')).toMatchObject({ totalCards: 1, studiedCards: 0 })
  })

  it('別々に作ったリポジトリはデータを共有しない', async () => {
    const a = setup()
    const b = setup()
    await a.reviews.recordReview(makeReviewRecord({ cardId: 'c1', logId: 'l1' }))
    await a.materials.save(makeMaterial({ id: 'm3' }))

    expect(await b.reviews.getStates('m1', ['c1'])).toEqual([])
    expect(await b.materials.get('m3')).toBeNull()
  })

  it('保存に渡したオブジェクトや取得したオブジェクトを書き換えても保存済みデータは変わらない', async () => {
    const repos = setup()
    const card = makeCard({ id: 'c9', order: 9, tags: ['a'] })
    await repos.cards.saveMany([card])
    card.tags.push('changed-after-save')

    const [loaded] = await repos.cards.getByIds('m1', ['c9'])
    loaded?.tags.push('changed-after-load')

    expect((await repos.cards.getByIds('m1', ['c9']))[0]?.tags).toEqual(['a'])
  })

  it('初期データの配列を書き換えても影響しない', async () => {
    const cards = [makeCard({ id: 'c1', order: 1 })]
    const repos = createMemoryRepositories({ materials: [makeMaterial()], cards })
    cards[0]!.question = '書き換え'
    expect((await repos.cards.getByIds('m1', ['c1']))[0]?.question).toBe('問題 c1')
  })

  it('初期データに同じカード id が重複していればエラー', () => {
    expect(() =>
      createMemoryRepositories({
        materials: [makeMaterial()],
        cards: [makeCard({ id: 'c1' }), makeCard({ id: 'c1' })],
      }),
    ).toThrow(AppError)
  })
})
