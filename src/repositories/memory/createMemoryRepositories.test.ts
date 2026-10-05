// @vitest-environment node
import { describe, expect, expectTypeOf, it } from 'vitest'
import { AppError, defaultAppSettings, type SchedulerConfig } from '../../domain'
import { hoursAfter, makeCard, makeMaterial, makeReviewRecord, T0 } from '../../test/factories'
import type { ReviewRepository } from '../types'
import { createMemoryRepositories, type MemorySeed } from './createMemoryRepositories'

function setup(seed: MemorySeed = {}) {
  return createMemoryRepositories(
    {
      materials: [makeMaterial({ id: 'm1' }), makeMaterial({ id: 'm2', title: '別の教材' })],
      cards: [
        makeCard({ id: 'c1', order: 1 }),
        makeCard({ id: 'c2', order: 2 }),
        makeCard({ id: 'c3', order: 3 }),
        makeCard({ id: 'c4', order: 4, isArchived: true }),
        makeCard({ id: 'c1', order: 1, materialId: 'm2', question: '別教材の c1' }),
      ],
      ...seed,
    },
    { clock: () => T0 },
  )
}

describe('MaterialRepository', () => {
  it('一覧・取得・保存', async () => {
    const repos = setup()
    expect((await repos.materials.list()).map((m) => m.id)).toEqual(['m1', 'm2'])
    expect(await repos.materials.get('none')).toBeNull()

    await repos.materials.save(makeMaterial({ id: 'm1', title: '改名' }))
    expect((await repos.materials.get('m1'))?.title).toBe('改名')
  })
})

describe('CardRepository', () => {
  it('教材ごとに分かれている（同じ id でも別の教材のカードは混ざらない）', async () => {
    const repos = setup()
    const [m1c1] = await repos.cards.getByIds('m1', ['c1'])
    const [m2c1] = await repos.cards.getByIds('m2', ['c1'])
    expect(m1c1?.question).toBe('問題 c1')
    expect(m2c1?.question).toBe('別教材の c1')
    expect(await repos.cards.countActive('m1')).toBe(3)
    expect(await repos.cards.countActive('m2')).toBe(1)
  })

  it('getByIds は指定した順に返し、存在しない id は含めない', async () => {
    const repos = setup()
    expect((await repos.cards.getByIds('m1', ['c3', 'none', 'c1'])).map((c) => c.id)).toEqual(['c3', 'c1'])
  })

  it('新規カードの候補を order 順に取り出す（アーカイブを除く）', async () => {
    const repos = setup()
    const candidates = await repos.cards.listNewCandidates('m1', { afterOrder: 1, limit: 10 })
    expect(candidates.map((c) => c.id)).toEqual(['c2', 'c3'])
  })

  it('不正な id のカードは保存せず、1 件でも不正なら何も保存しない', async () => {
    const repos = setup()
    await expect(
      repos.cards.saveMany([makeCard({ id: 'ok-new', order: 5 }), makeCard({ id: 'bad/id', order: 6 })]),
    ).rejects.toThrow(AppError)
    expect(await repos.cards.getByIds('m1', ['ok-new'])).toEqual([])
  })

  it('存在しない教材のカードは保存できない', async () => {
    const repos = setup()
    await expect(repos.cards.saveMany([makeCard({ id: 'x', materialId: 'none' })])).rejects.toMatchObject({
      kind: 'not-found',
    })
  })
})

describe('Card の更新と ReviewState は独立している', () => {
  it('カードの内容を更新しても ReviewState・ReviewLog・集計は変わらない', async () => {
    const repos = setup()
    await repos.reviews.recordReview(makeReviewRecord({ cardId: 'c1', logId: 'l1' }))
    const stateBefore = await repos.reviews.getStates('m1', ['c1'])
    const logsBefore = await repos.reviews.listLogsForCard('m1', 'c1', { limit: 10 })
    const progressBefore = await repos.reviews.getProgress('m1')

    await repos.cards.saveMany([
      makeCard({ id: 'c1', order: 1, question: '修正後の問題', answer: '修正後の答え', category: '別カテゴリー' }),
    ])

    expect((await repos.cards.getByIds('m1', ['c1']))[0]?.question).toBe('修正後の問題')
    expect(await repos.reviews.getStates('m1', ['c1'])).toEqual(stateBefore)
    expect(await repos.reviews.listLogsForCard('m1', 'c1', { limit: 10 })).toEqual(logsBefore)
    expect(await repos.reviews.getProgress('m1')).toEqual(progressBefore)
  })
})

describe('ReviewRepository', () => {
  it('未学習カードには ReviewState がない', async () => {
    const repos = setup()
    expect(await repos.reviews.getStates('m1', ['c1', 'c2'])).toEqual([])
  })

  it('レビューを記録すると ReviewState が保存され、ReviewLog が追記され、集計が加算される', async () => {
    const repos = setup()
    const record = makeReviewRecord({ cardId: 'c2', logId: 'l1', rating: 'hard', cardOrder: 2 })
    await repos.reviews.recordReview(record)

    expect(await repos.reviews.getStates('m1', ['c2'])).toEqual([record.state])
    expect(await repos.reviews.listLogsForCard('m1', 'c2', { limit: 10 })).toEqual([record.log])
    const progress = await repos.reviews.getProgress('m1')
    expect(progress).toMatchObject({ totalCards: 3, studiedCards: 1, newCursorOrder: 2 })
    expect(progress.ratingCounts.hard).toBe(1)
  })

  it('2 回目のレビューで ReviewState が更新され、ReviewLog は 2 件になる（新しい順）', async () => {
    const repos = setup()
    const first = makeReviewRecord({ cardId: 'c1', logId: 'l1' })
    await repos.reviews.recordReview(first)
    const second = makeReviewRecord({
      cardId: 'c1',
      logId: 'l2',
      rating: 'again',
      reviewedAt: hoursAfter(T0, 24),
      previous: first.log.nextState,
      next: { phase: 'relearning', lapses: 1, reps: 2, due: hoursAfter(T0, 24.2) },
    })
    await repos.reviews.recordReview(second)

    const [state] = await repos.reviews.getStates('m1', ['c1'])
    expect(state).toMatchObject({ phase: 'relearning', lapses: 1, lastLogId: 'l2' })
    const logs = await repos.reviews.listLogsForCard('m1', 'c1', { limit: 10 })
    expect(logs.map((l) => l.id)).toEqual(['l2', 'l1'])
    expect(logs[0]?.previousState).toEqual(first.log.nextState)
    expect((await repos.reviews.listLogsForCard('m1', 'c1', { limit: 1 })).map((l) => l.id)).toEqual(['l2'])

    const progress = await repos.reviews.getProgress('m1')
    expect(progress.studiedCards).toBe(1)
    expect(progress.ratingCounts).toMatchObject({ good: 1, again: 1 })
  })

  it('期限が指定日時より前のカードだけを期限順に返す', async () => {
    const repos = setup()
    await repos.reviews.recordReview(
      makeReviewRecord({ cardId: 'c1', logId: 'l1', next: { due: hoursAfter(T0, 30) } }),
    )
    await repos.reviews.recordReview(
      makeReviewRecord({ cardId: 'c2', logId: 'l2', next: { due: hoursAfter(T0, 10) } }),
    )
    await repos.reviews.recordReview(
      makeReviewRecord({ cardId: 'c3', logId: 'l3', next: { due: hoursAfter(T0, 100) } }),
    )
    const dueBefore = hoursAfter(T0, 48)
    expect((await repos.reviews.listDue('m1', { dueBefore })).map((s) => s.cardId)).toEqual(['c2', 'c1'])
    expect((await repos.reviews.listDue('m1', { dueBefore, limit: 1 })).map((s) => s.cardId)).toEqual(['c2'])
    expect(await repos.reviews.listDue('m2', { dueBefore })).toEqual([])
  })

  describe('ReviewLog は追記のみ', () => {
    it('既存の ReviewLog を変更・削除するメソッドがない', () => {
      // 型レベルの確認：メソッドを追加したらこのテストの更新（＝設計の見直し）が必要になる
      expectTypeOf<keyof ReviewRepository>().toEqualTypeOf<
        'getStates' | 'listDue' | 'recordReview' | 'listLogsForCard' | 'getProgress'
      >()
    })

    it('同じ id の ReviewLog は追記できず、何も変更されない', async () => {
      const repos = setup()
      await repos.reviews.recordReview(makeReviewRecord({ cardId: 'c1', logId: 'l1', rating: 'good' }))
      const overwrite = makeReviewRecord({ cardId: 'c1', logId: 'l1', rating: 'easy' })
      await expect(repos.reviews.recordReview(overwrite)).rejects.toMatchObject({ kind: 'conflict' })

      const logs = await repos.reviews.listLogsForCard('m1', 'c1', { limit: 10 })
      expect(logs.map((l) => l.rating)).toEqual(['good'])
      expect((await repos.reviews.getProgress('m1')).ratingCounts.easy).toBe(0)
    })

    it('取得した ReviewLog を書き換えても保存済みの履歴は変わらない', async () => {
      const repos = setup()
      await repos.reviews.recordReview(makeReviewRecord({ cardId: 'c1', logId: 'l1' }))
      const [log] = await repos.reviews.listLogsForCard('m1', 'c1', { limit: 1 })
      // readonly を無視して書き換えを試みる
      ;(log as { rating: string }).rating = 'again'
      log?.nextState.due.setFullYear(2000)

      const [stored] = await repos.reviews.listLogsForCard('m1', 'c1', { limit: 1 })
      expect(stored?.rating).toBe('good')
      expect(stored?.nextState.due.getFullYear()).not.toBe(2000)
    })
  })

  describe('整合しないレビュー結果は保存しない（すべて保存するか、何も保存しない）', () => {
    it.each([
      [
        'ReviewState の lastLogId が ReviewLog の id と違う',
        () => {
          const r = makeReviewRecord({ cardId: 'c1', logId: 'l1' })
          return { ...r, state: { ...r.state, lastLogId: 'other' } }
        },
      ],
      [
        'ReviewState の FSRS 値が ReviewLog の nextState と違う',
        () => {
          const r = makeReviewRecord({ cardId: 'c1', logId: 'l1' })
          return { ...r, state: { ...r.state, stability: r.state.stability + 1 } }
        },
      ],
      [
        'ReviewState と ReviewLog のカードが違う',
        () => {
          const r = makeReviewRecord({ cardId: 'c1', logId: 'l1' })
          return { ...r, state: { ...r.state, cardId: 'c2' } }
        },
      ],
    ])('%s', async (_label, build) => {
      const repos = setup()
      await expect(repos.reviews.recordReview(build())).rejects.toMatchObject({ kind: 'invalid-data' })
      expect(await repos.reviews.getStates('m1', ['c1', 'c2'])).toEqual([])
      expect(await repos.reviews.listLogsForCard('m1', 'c1', { limit: 10 })).toEqual([])
      expect((await repos.reviews.getProgress('m1')).studiedCards).toBe(0)
    })
  })

  it('初期データから集計を作る（アーカイブ除く）', async () => {
    const repos = setup()
    expect(await repos.reviews.getProgress('m1')).toMatchObject({ totalCards: 3, studiedCards: 0 })
    expect(await repos.reviews.getProgress('unknown')).toMatchObject({ totalCards: 0, materialId: 'unknown' })
  })
})

describe('SettingsRepository', () => {
  it('保存されていなければ既定値', async () => {
    const repos = setup()
    expect(await repos.settings.getSettings()).toEqual(defaultAppSettings(T0))
  })

  it('設定を保存・取得できる', async () => {
    const repos = setup()
    await repos.settings.saveSettings({ ...defaultAppSettings(T0), dayStartHour: 5 })
    expect((await repos.settings.getSettings()).dayStartHour).toBe(5)
  })

  it('FSRS 設定の記録は作成のみ（同じ内容は何もしない・違う内容は conflict）', async () => {
    const repos = setup()
    const config: SchedulerConfig = {
      id: 'ts-fsrs@5.4.2-00000000',
      library: 'ts-fsrs',
      libraryVersion: '5.4.2',
      params: {
        requestRetention: 0.9,
        maximumInterval: 36500,
        weights: [1, 2, 3],
        enableFuzz: true,
        enableShortTerm: true,
        learningSteps: ['1m', '10m'],
        relearningSteps: ['10m'],
      },
      createdAt: T0,
    }
    await repos.settings.saveSchedulerConfig(config)
    await repos.settings.saveSchedulerConfig(structuredClone(config))
    await expect(
      repos.settings.saveSchedulerConfig({ ...config, params: { ...config.params, requestRetention: 0.8 } }),
    ).rejects.toMatchObject({ kind: 'conflict' })
    expect(await repos.settings.getSchedulerConfig(config.id)).toEqual(config)
  })
})

describe('データの共有範囲', () => {
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
