import { describe, expect, expectTypeOf, it } from 'vitest'
import {
  AppError,
  defaultAppSettings,
  rebuildProgress,
  restoreStateFromLogs,
  type Card,
  type SchedulerConfig,
  type StudyMaterial,
} from '../domain'
import { hoursAfter, makeCard, makeMaterial, makeReviewRecord, T0 } from '../test/factories'
import type { Repositories, ReviewRepository } from './types'

/**
 * リポジトリの契約テスト。メモリ実装（npm test）と Firestore 実装（npm run test:rules、Emulator）の
 * 両方で同じテストを実行し、interface どおりに同じ振る舞いをすることを確認する。
 *
 * createEmpty は空のリポジトリを返す（実行ごとに独立したデータ）。
 */
export function describeRepositoryContract(name: string, createEmpty: () => Promise<Repositories>) {
  const MATERIALS: StudyMaterial[] = [makeMaterial({ id: 'm1' }), makeMaterial({ id: 'm2', title: '別の教材' })]
  const CARDS: Card[] = [
    makeCard({ id: 'c1', order: 1 }),
    makeCard({ id: 'c2', order: 2 }),
    makeCard({ id: 'c3', order: 3 }),
    makeCard({ id: 'c4', order: 4, isArchived: true }),
    makeCard({ id: 'c1', order: 1, materialId: 'm2', question: '別教材の c1' }),
  ]

  /** 教材 2 つ・カード 5 枚と、その集計を保存した状態 */
  async function setup(): Promise<Repositories> {
    const repos = await createEmpty()
    for (const material of MATERIALS) await repos.materials.save(material)
    await repos.cards.saveMany(CARDS)
    for (const material of MATERIALS) {
      await repos.reviews.replaceProgress(
        rebuildProgress({ materialId: material.id, cards: CARDS, states: [], now: T0 }),
      )
    }
    return repos
  }

  describe(`リポジトリの契約（${name}）`, () => {
    describe('MaterialRepository', () => {
      it('一覧・取得・保存', async () => {
        const repos = await setup()
        expect((await repos.materials.list()).map((m) => m.id).sort()).toEqual(['m1', 'm2'])
        expect(await repos.materials.get('m1')).toEqual(MATERIALS[0])
        expect(await repos.materials.get('none')).toBeNull()

        await repos.materials.save(makeMaterial({ id: 'm1', title: '改名' }))
        expect((await repos.materials.get('m1'))?.title).toBe('改名')
      })
    })

    describe('CardRepository', () => {
      it('教材ごとに分かれている（同じ id でも別の教材のカードは混ざらない）', async () => {
        const repos = await setup()
        expect((await repos.cards.getByIds('m1', ['c1']))[0]?.question).toBe('問題 c1')
        expect((await repos.cards.getByIds('m2', ['c1']))[0]?.question).toBe('別教材の c1')
        expect(await repos.cards.countActive('m1')).toBe(3)
        expect(await repos.cards.countActive('m2')).toBe(1)
      })

      it('保存したカードを日時も含めてそのまま取得できる', async () => {
        const repos = await setup()
        const card = makeCard({
          id: 'full',
          order: 10,
          subcategory: '小分類',
          tags: ['a', 'b'],
          examDifficulty: 3,
          importance: 5,
          imageUrl: '/images/x.svg',
          source: '出典',
          notes: 'メモ',
          createdAt: new Date('2026-01-02T03:04:05.678Z'),
        })
        await repos.cards.saveMany([card])
        expect(await repos.cards.getByIds('m1', ['full'])).toEqual([card])
      })

      it('getByIds は指定した順に返し、存在しない id は含めない', async () => {
        const repos = await setup()
        expect((await repos.cards.getByIds('m1', ['c3', 'none', 'c1'])).map((c) => c.id)).toEqual(['c3', 'c1'])
        expect(await repos.cards.getByIds('m1', [])).toEqual([])
      })

      it('getByIds は 30 件を超える id もまとめて取得できる', async () => {
        const repos = await setup()
        const many = Array.from({ length: 35 }, (_, i) => makeCard({ id: `bulk-${i}`, order: 100 + i }))
        await repos.cards.saveMany(many)
        const ids = many.map((c) => c.id).reverse()
        expect((await repos.cards.getByIds('m1', ids)).map((c) => c.id)).toEqual(ids)
      })

      it('新規カードの候補を order 順に取り出す（アーカイブを除く・afterOrder より後・limit 件）', async () => {
        const repos = await setup()
        expect((await repos.cards.listNewCandidates('m1', { afterOrder: 0, limit: 10 })).map((c) => c.id)).toEqual([
          'c1',
          'c2',
          'c3',
        ])
        expect((await repos.cards.listNewCandidates('m1', { afterOrder: 1, limit: 1 })).map((c) => c.id)).toEqual([
          'c2',
        ])
        expect(await repos.cards.listNewCandidates('m1', { afterOrder: 0, limit: 0 })).toEqual([])
      })

      it('不正な id のカードは保存せず、1 件でも不正なら何も保存しない', async () => {
        const repos = await setup()
        await expect(
          repos.cards.saveMany([makeCard({ id: 'ok-new', order: 5 }), makeCard({ id: 'bad/id', order: 6 })]),
        ).rejects.toThrow(AppError)
        expect(await repos.cards.getByIds('m1', ['ok-new'])).toEqual([])
      })

      it('存在しない教材のカードは保存できない', async () => {
        const repos = await setup()
        await expect(repos.cards.saveMany([makeCard({ id: 'x', materialId: 'none' })])).rejects.toMatchObject({
          kind: 'not-found',
        })
      })
    })

    describe('Card の更新と ReviewState は独立している', () => {
      it('カードの内容を更新しても ReviewState・ReviewLog・集計は変わらない', async () => {
        const repos = await setup()
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
        const repos = await setup()
        expect(await repos.reviews.getStates('m1', ['c1', 'c2'])).toEqual([])
      })

      it('レビューを記録すると ReviewState が保存され、ReviewLog が追記され、集計が加算される', async () => {
        const repos = await setup()
        const record = makeReviewRecord({ cardId: 'c2', logId: 'l1', rating: 'hard', cardOrder: 2 })
        await repos.reviews.recordReview(record)

        expect(await repos.reviews.getStates('m1', ['c2'])).toEqual([record.state])
        expect(await repos.reviews.listLogsForCard('m1', 'c2', { limit: 10 })).toEqual([record.log])
        const progress = await repos.reviews.getProgress('m1')
        expect(progress).toMatchObject({ totalCards: 3, studiedCards: 1, newCursorOrder: 2 })
        expect(progress.ratingCounts.hard).toBe(1)
        expect(progress.daily['2026-10-01']).toEqual({ reviews: 1, newCards: 1 })
      })

      it('2 回目のレビューで ReviewState が更新され、ReviewLog は 2 件になる（新しい順）', async () => {
        const repos = await setup()
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
        expect((await repos.reviews.getProgress('m1')).ratingCounts).toMatchObject({ good: 1, again: 1 })
      })

      it('期限が指定日時より前のカードだけを期限順に返す', async () => {
        const repos = await setup()
        for (const [cardId, hours] of [['c1', 30], ['c2', 10], ['c3', 100]] as const) {
          await repos.reviews.recordReview(
            makeReviewRecord({ cardId, logId: `l-${cardId}`, next: { due: hoursAfter(T0, hours) } }),
          )
        }
        const dueBefore = hoursAfter(T0, 48)
        expect((await repos.reviews.listDue('m1', { dueBefore })).map((s) => s.cardId)).toEqual(['c2', 'c1'])
        expect((await repos.reviews.listDue('m1', { dueBefore, limit: 1 })).map((s) => s.cardId)).toEqual(['c2'])
        expect(await repos.reviews.listDue('m2', { dueBefore })).toEqual([])
      })

      it('一時停止中のカードは期限が来ていても返さない', async () => {
        const repos = await setup()
        const record = makeReviewRecord({ cardId: 'c1', logId: 'l1', next: { due: hoursAfter(T0, 1) } })
        await repos.reviews.recordReview({ ...record, state: { ...record.state, suspended: true } })
        expect(await repos.reviews.listDue('m1', { dueBefore: hoursAfter(T0, 48) })).toEqual([])
      })

      it('ReviewLog がある カードを見つける', async () => {
        const repos = await setup()
        await repos.reviews.recordReview(makeReviewRecord({ cardId: 'c2', logId: 'l1' }))
        expect(await repos.reviews.findCardsWithLogs('m1', ['c1', 'c2', 'c3'])).toEqual(['c2'])
        expect(await repos.reviews.findCardsWithLogs('m2', ['c2'])).toEqual([])
        expect(await repos.reviews.findCardsWithLogs('m1', [])).toEqual([])
      })

      describe('ReviewLog は追記のみ・二重登録しない', () => {
        it('既存の ReviewLog を変更・削除するメソッドがない', () => {
          // 型レベルの確認：メソッドを追加したらこのテストの更新（＝設計の見直し）が必要になる
          expectTypeOf<keyof ReviewRepository>().toEqualTypeOf<
            | 'getStates'
            | 'listDue'
            | 'recordReview'
            | 'listLogsForCard'
            | 'findCardsWithLogs'
            | 'restoreState'
            | 'getProgress'
            | 'replaceProgress'
          >()
        })

        it('同じレビューを再送しても（再試行・二重押し）、履歴と集計は 1 回分だけ', async () => {
          const repos = await setup()
          const record = makeReviewRecord({ cardId: 'c1', logId: 'l1' })
          await repos.reviews.recordReview(record)
          await repos.reviews.recordReview(record)
          await repos.reviews.recordReview(structuredClone(record))

          expect(await repos.reviews.listLogsForCard('m1', 'c1', { limit: 10 })).toHaveLength(1)
          const progress = await repos.reviews.getProgress('m1')
          expect(progress.ratingCounts.good).toBe(1)
          expect(progress.studiedCards).toBe(1)
        })

        it('同じ id で内容の違うレビューは conflict で、何も変更されない', async () => {
          const repos = await setup()
          await repos.reviews.recordReview(makeReviewRecord({ cardId: 'c1', logId: 'l1', rating: 'good' }))
          const overwrite = makeReviewRecord({ cardId: 'c1', logId: 'l1', rating: 'easy' })
          await expect(repos.reviews.recordReview(overwrite)).rejects.toMatchObject({ kind: 'conflict' })

          const logs = await repos.reviews.listLogsForCard('m1', 'c1', { limit: 10 })
          expect(logs.map((l) => l.rating)).toEqual(['good'])
          expect((await repos.reviews.getProgress('m1')).ratingCounts.easy).toBe(0)
        })

        it('保存済みの状態が previousState と違う（別の端末で先に学習された）場合は conflict', async () => {
          const repos = await setup()
          const first = makeReviewRecord({ cardId: 'c1', logId: 'l1' })
          await repos.reviews.recordReview(first)
          // 古い状態（未学習）を前提にした別のレビュー
          const stale = makeReviewRecord({ cardId: 'c1', logId: 'l2', previous: null, reviewedAt: hoursAfter(T0, 1) })
          await expect(repos.reviews.recordReview(stale)).rejects.toMatchObject({ kind: 'conflict' })
          expect((await repos.reviews.getStates('m1', ['c1']))[0]?.lastLogId).toBe('l1')
          expect(await repos.reviews.listLogsForCard('m1', 'c1', { limit: 10 })).toHaveLength(1)
        })

        it('取得した ReviewLog を書き換えても保存済みの履歴は変わらない', async () => {
          const repos = await setup()
          await repos.reviews.recordReview(makeReviewRecord({ cardId: 'c1', logId: 'l1' }))
          const [log] = await repos.reviews.listLogsForCard('m1', 'c1', { limit: 1 })
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
          const repos = await setup()
          await expect(repos.reviews.recordReview(build())).rejects.toMatchObject({ kind: 'invalid-data' })
          expect(await repos.reviews.getStates('m1', ['c1', 'c2'])).toEqual([])
          expect(await repos.reviews.listLogsForCard('m1', 'c1', { limit: 10 })).toEqual([])
          expect((await repos.reviews.getProgress('m1')).studiedCards).toBe(0)
        })
      })

      describe('履歴からの復元（restoreState）', () => {
        it('最新の ReviewLog から作った状態を保存できる（ReviewLog と集計は変わらない）', async () => {
          const repos = await setup()
          const first = makeReviewRecord({ cardId: 'c1', logId: 'l1' })
          await repos.reviews.recordReview(first)
          const second = makeReviewRecord({
            cardId: 'c1',
            logId: 'l2',
            rating: 'easy',
            reviewedAt: hoursAfter(T0, 30),
            previous: first.log.nextState,
            next: { reps: 2, due: hoursAfter(T0, 200) },
          })
          await repos.reviews.recordReview(second)
          const progressBefore = await repos.reviews.getProgress('m1')

          const logs = await repos.reviews.listLogsForCard('m1', 'c1', { limit: 100 })
          const restored = restoreStateFromLogs(logs, { suspended: false, now: hoursAfter(T0, 40) })
          if (!restored) throw new Error('unreachable')
          await repos.reviews.restoreState(restored)

          const [state] = await repos.reviews.getStates('m1', ['c1'])
          expect(state).toMatchObject({ lastLogId: 'l2', reps: 2, ratingCounts: { good: 1, easy: 1 } })
          expect(state?.due).toEqual(hoursAfter(T0, 200))
          expect(state?.firstReviewedAt).toEqual(T0)
          expect(await repos.reviews.listLogsForCard('m1', 'c1', { limit: 100 })).toHaveLength(2)
          expect(await repos.reviews.getProgress('m1')).toEqual(progressBefore)
        })

        it('ReviewLog と一致しない状態・存在しない ReviewLog を参照する状態は保存しない', async () => {
          const repos = await setup()
          const record = makeReviewRecord({ cardId: 'c1', logId: 'l1' })
          await repos.reviews.recordReview(record)
          await expect(
            repos.reviews.restoreState({ ...record.state, stability: 99 }),
          ).rejects.toMatchObject({ kind: 'invalid-data' })
          await expect(
            repos.reviews.restoreState({ ...record.state, lastLogId: 'missing' }),
          ).rejects.toMatchObject({ kind: 'invalid-data' })
          expect((await repos.reviews.getStates('m1', ['c1']))[0]).toEqual(record.state)
        })
      })

      it('集計を置き換えられる', async () => {
        const repos = await setup()
        const progress = { ...(await repos.reviews.getProgress('m1')), totalCards: 42 }
        await repos.reviews.replaceProgress(progress)
        expect(await repos.reviews.getProgress('m1')).toEqual(progress)
      })

      it('集計がまだない教材は空の集計', async () => {
        const repos = await createEmpty()
        await repos.materials.save(makeMaterial({ id: 'm9' }))
        expect(await repos.reviews.getProgress('m9')).toMatchObject({ materialId: 'm9', totalCards: 0, studiedCards: 0 })
      })
    })

    describe('SettingsRepository', () => {
      it('保存されていなければ既定値、保存すればその値', async () => {
        const repos = await setup()
        const settings = await repos.settings.getSettings()
        expect({ ...settings, updatedAt: T0 }).toEqual(defaultAppSettings(T0))
        await repos.settings.saveSettings({ ...defaultAppSettings(T0), dayStartHour: 5, lastMaterialId: 'm2' })
        expect(await repos.settings.getSettings()).toMatchObject({ dayStartHour: 5, lastMaterialId: 'm2' })
      })

      it('FSRS 設定の記録は作成のみ（同じ内容は何もしない・違う内容は conflict）', async () => {
        const repos = await setup()
        const config: SchedulerConfig = {
          id: 'ts-fsrs@5.4.2-00000000',
          library: 'ts-fsrs',
          libraryVersion: '5.4.2',
          params: {
            requestRetention: 0.9,
            maximumInterval: 36500,
            weights: [0.1, 1.2, 3.4],
            enableFuzz: true,
            enableShortTerm: true,
            learningSteps: ['1m', '10m'],
            relearningSteps: ['10m'],
          },
          createdAt: T0,
        }
        expect(await repos.settings.getSchedulerConfig(config.id)).toBeNull()
        await repos.settings.saveSchedulerConfig(config)
        await repos.settings.saveSchedulerConfig({ ...structuredClone(config), createdAt: hoursAfter(T0, 5) })
        await expect(
          repos.settings.saveSchedulerConfig({ ...config, params: { ...config.params, requestRetention: 0.8 } }),
        ).rejects.toMatchObject({ kind: 'conflict' })
        expect(await repos.settings.getSchedulerConfig(config.id)).toEqual(config)
      })
    })
  })
}
