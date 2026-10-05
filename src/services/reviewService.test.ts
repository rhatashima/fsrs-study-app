// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { defaultAppSettings, emptyRatingCounts, toSchedulingSnapshot } from '../domain'
import { createFsrsScheduler } from '../lib/fsrs'
import { makeCard } from '../test/factories'
import { reviewCard } from './reviewService'

const T = new Date(2026, 9, 6, 10, 0) // ローカル時刻 2026-10-06 10:00
const scheduler = createFsrsScheduler(defaultAppSettings(T), T)
const card = makeCard({ id: 'c1', order: 7, category: '石垣' })

describe('reviewCard', () => {
  it('新規カード（ReviewState なし）を Good：previousState は null、次の状態から ReviewState を作る', () => {
    const record = reviewCard({
      scheduler,
      card,
      current: null,
      rating: 'good',
      reviewedAt: T,
      logId: 'log-1',
      durationMs: 3000,
      dayStartHour: 4,
    })

    expect(record.log).toMatchObject({
      id: 'log-1',
      cardId: 'c1',
      materialId: 'm1',
      reviewedAt: T,
      rating: 'good',
      previousState: null,
      durationMs: 3000,
    })
    expect(record.log.nextState).toEqual(scheduler.apply(null, 'good', T))
    expect(toSchedulingSnapshot(record.state)).toEqual(record.log.nextState)
    expect(record.state).toMatchObject({
      cardId: 'c1',
      materialId: 'm1',
      suspended: false,
      firstReviewedAt: T,
      ratingCounts: { ...emptyRatingCounts(), good: 1 },
      lastLogId: 'log-1',
      updatedAt: T,
    })
    expect(record.context).toEqual({ category: '石垣', cardOrder: 7, dayKey: '2026-10-06' })
  })

  it('FSRS 設定への参照とライブラリのバージョンを記録する', () => {
    const record = reviewCard({
      scheduler,
      card,
      current: null,
      rating: 'easy',
      reviewedAt: T,
      logId: 'log-1',
      durationMs: null,
      dayStartHour: 4,
    })
    expect(record.log.scheduler).toEqual({
      configId: scheduler.config.id,
      library: 'ts-fsrs',
      libraryVersion: '5.4.2',
    })
    expect(record.state.schedulerConfigId).toBe(scheduler.config.id)
  })

  it('既存カードを Again：previousState は直前の状態、評価回数と初回日時は引き継ぐ', () => {
    const first = reviewCard({
      scheduler,
      card,
      current: null,
      rating: 'good',
      reviewedAt: T,
      logId: 'log-1',
      durationMs: null,
      dayStartHour: 4,
    })
    const later = new Date(2026, 9, 8, 3, 0) // 10/8 3:00 → 10/7 の学習日
    const second = reviewCard({
      scheduler,
      card,
      current: first.state,
      rating: 'again',
      reviewedAt: later,
      logId: 'log-2',
      durationMs: null,
      dayStartHour: 4,
    })

    expect(second.log.previousState).toEqual(first.log.nextState)
    expect(second.state).toMatchObject({
      firstReviewedAt: T,
      ratingCounts: { ...emptyRatingCounts(), good: 1, again: 1 },
      lastLogId: 'log-2',
    })
    expect(second.context.dayKey).toBe('2026-10-07')
  })

  it('一時停止の状態は引き継ぐ', () => {
    const first = reviewCard({
      scheduler,
      card,
      current: null,
      rating: 'good',
      reviewedAt: T,
      logId: 'log-1',
      durationMs: null,
      dayStartHour: 4,
    })
    const second = reviewCard({
      scheduler,
      card,
      current: { ...first.state, suspended: true },
      rating: 'good',
      reviewedAt: new Date(2026, 9, 6, 10, 10),
      logId: 'log-2',
      durationMs: null,
      dayStartHour: 4,
    })
    expect(second.state.suspended).toBe(true)
  })
})
