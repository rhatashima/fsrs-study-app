// @vitest-environment node
import { createEmptyCard, default_w, fsrs, FSRSVersion, generatorParameters, Rating } from 'ts-fsrs'
import { describe, expect, it } from 'vitest'
import { defaultAppSettings, REVIEW_RATINGS, type SchedulingSnapshot } from '../../domain'
import { fromFsrsCard, toFsrsCard } from './adapter'
import { createFsrsScheduler, FSRS_LIBRARY_VERSION, parseLibraryVersion } from './scheduler'

const T = new Date('2026-10-05T10:00:00+09:00')
const minutesAfter = (base: Date, minutes: number) => new Date(base.getTime() + minutes * 60_000)
const settings = defaultAppSettings(T)

describe('ライブラリのバージョン', () => {
  it('ts-fsrs 5.4.2 を使っている（バージョンを上げたらこのテストとドキュメントを更新する）', () => {
    expect(FSRS_LIBRARY_VERSION).toBe('5.4.2')
    expect(FSRSVersion).toMatch(/^v5\.4\.2 /)
  })

  it('FSRSVersion の文字列からバージョンを取り出す', () => {
    expect(parseLibraryVersion('v5.4.2 using FSRS-6.0')).toBe('5.4.2')
    expect(() => parseLibraryVersion('unknown')).toThrow()
  })
})

describe('FSRS 設定（SchedulerConfig）', () => {
  const { config } = createFsrsScheduler(settings, T)

  it('アプリの初期設定を明示的に使う（ライブラリ既定の enable_fuzz=false ではなく true）', () => {
    expect(config.params).toMatchObject({
      requestRetention: 0.9,
      maximumInterval: 36500,
      enableFuzz: true,
      enableShortTerm: true,
      learningSteps: ['1m', '10m'],
      relearningSteps: ['10m'],
    })
  })

  it('記録するのは ts-fsrs が正規化した後の、実際に計算に使うパラメータ', () => {
    const normalized = fsrs(
      generatorParameters({
        request_retention: 0.9,
        maximum_interval: 36500,
        enable_fuzz: true,
        enable_short_term: true,
        learning_steps: ['1m', '10m'],
        relearning_steps: ['10m'],
      }),
    ).parameters
    expect(config.params.weights).toEqual([...normalized.w])
    expect(config.params.weights).toEqual([...default_w])
  })

  it('ライブラリ名・バージョン・設定 id を持つ', () => {
    expect(config.library).toBe('ts-fsrs')
    expect(config.libraryVersion).toBe('5.4.2')
    expect(config.id).toMatch(/^ts-fsrs@5\.4\.2-[0-9a-f]{8}$/)
  })

  it('同じ設定なら同じ id、設定を変えると別の id', () => {
    expect(createFsrsScheduler(settings, minutesAfter(T, 60)).config.id).toBe(config.id)
    expect(createFsrsScheduler({ ...settings, requestRetention: 0.85 }, T).config.id).not.toBe(config.id)
    expect(createFsrsScheduler({ ...settings, learningSteps: ['5m'] }, T).config.id).not.toBe(config.id)
  })

  it('最適化した重みを設定すると、その重みで計算する', () => {
    const weights = [...default_w].map((w, i) => (i === 0 ? w + 0.1 : w))
    const custom = createFsrsScheduler({ ...settings, fsrsWeights: weights }, T)
    expect(custom.config.params.weights[0]).toBeCloseTo(weights[0] as number)
    expect(custom.config.id).not.toBe(config.id)
  })
})

describe('preview（4 評価それぞれの次回予定）', () => {
  const scheduler = createFsrsScheduler(settings, T)

  it('新規カード：Again 1 分後、Hard 6 分後、Good 10 分後（学習ステップ）、Easy は数日後の復習', () => {
    const preview = scheduler.preview(null, T)
    expect(Object.keys(preview).sort()).toEqual([...REVIEW_RATINGS].sort())
    expect(preview.again.due).toEqual(minutesAfter(T, 1))
    expect(preview.hard.due).toEqual(minutesAfter(T, 6))
    expect(preview.good.due).toEqual(minutesAfter(T, 10))
    expect(preview.again.phase).toBe('learning')
    expect(preview.easy.phase).toBe('review')
    expect(preview.easy.scheduledDays).toBeGreaterThanOrEqual(1)
  })

  it('preview は渡した状態を変更しない', () => {
    const current = scheduler.apply(null, 'good', T)
    const before = structuredClone(current)
    scheduler.preview(current, minutesAfter(T, 10))
    expect(current).toEqual(before)
  })

  it('同じ時刻なら preview と実際の計算結果は一致する', () => {
    const current = scheduler.apply(null, 'good', T)
    const now = minutesAfter(T, 10)
    const preview = scheduler.preview(current, now)
    for (const rating of REVIEW_RATINGS) {
      expect(scheduler.apply(current, rating, now).due).toEqual(preview[rating].due)
    }
  })
})

describe('apply（評価を適用した次の状態）', () => {
  const scheduler = createFsrsScheduler(settings, T)

  it('新規カードを Again → 学習中、1 分後に再出題', () => {
    const next = scheduler.apply(null, 'again', T)
    expect(next).toMatchObject({ phase: 'learning', reps: 1, lapses: 0, lastReviewedAt: T })
    expect(next.due).toEqual(minutesAfter(T, 1))
  })

  it('新規カードを Good → 学習中、次の学習ステップ（10 分後）', () => {
    const next = scheduler.apply(null, 'good', T)
    expect(next).toMatchObject({ phase: 'learning', reps: 1, learningSteps: 1 })
    expect(next.due).toEqual(minutesAfter(T, 10))
  })

  it('復習（Review）カードを Again → 再学習（Relearning）、lapses が増え、10 分後に再出題', () => {
    let current: SchedulingSnapshot = scheduler.apply(null, 'good', T)
    current = scheduler.apply(current, 'good', current.due)
    expect(current.phase).toBe('review')
    const reviewAt = current.due
    const next = scheduler.apply(current, 'again', reviewAt)
    expect(next).toMatchObject({ phase: 'relearning', lapses: 1, reps: current.reps + 1 })
    expect(next.due).toEqual(minutesAfter(reviewAt, 10))
  })

  it('計算は ts-fsrs に任せている（ts-fsrs を直接使った結果と一致する）', () => {
    const engine = fsrs(
      generatorParameters({ enable_fuzz: true, learning_steps: ['1m', '10m'], relearning_steps: ['10m'] }),
    )
    let direct = engine.next(createEmptyCard(T), T, Rating.Good).card
    let viaApp: SchedulingSnapshot = scheduler.apply(null, 'good', T)
    expect(viaApp).toEqual(fromFsrsCard(direct))

    const later = new Date(T.getTime() + 3 * 86_400_000)
    direct = engine.next(direct, later, Rating.Hard).card
    viaApp = scheduler.apply(viaApp, 'hard', later)
    expect(viaApp).toEqual(fromFsrsCard(direct))
    expect(toFsrsCard(viaApp).due).toEqual(direct.due)
  })
})
