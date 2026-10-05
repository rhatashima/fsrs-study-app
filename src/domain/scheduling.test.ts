// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { makeSnapshot, makeState } from '../test/factories'
import { schedulerConfigId, snapshotsEqual, toSchedulingSnapshot, type FsrsParams } from './scheduling'

const params: FsrsParams = {
  requestRetention: 0.9,
  maximumInterval: 36500,
  weights: [0.2, 1.3, 2.3, 8.3],
  enableFuzz: true,
  enableShortTerm: true,
  learningSteps: ['1m', '10m'],
  relearningSteps: ['10m'],
}

describe('schedulerConfigId', () => {
  it('同じライブラリ・バージョン・パラメータなら同じ id', () => {
    expect(schedulerConfigId('ts-fsrs', '5.4.2', params)).toBe(
      schedulerConfigId('ts-fsrs', '5.4.2', { ...params, weights: [...params.weights] }),
    )
  })

  it('id にライブラリ名とバージョンを含む', () => {
    expect(schedulerConfigId('ts-fsrs', '5.4.2', params)).toMatch(/^ts-fsrs@5\.4\.2-[0-9a-f]{8}$/)
  })

  it.each<[string, Partial<FsrsParams>]>([
    ['目標保持率', { requestRetention: 0.85 }],
    ['重み', { weights: [0.2, 1.3, 2.3, 8.4] }],
    ['学習ステップ', { learningSteps: ['1m'] }],
    ['ゆらぎ', { enableFuzz: false }],
  ])('%s が違えば別の id', (_label, change) => {
    expect(schedulerConfigId('ts-fsrs', '5.4.2', { ...params, ...change })).not.toBe(
      schedulerConfigId('ts-fsrs', '5.4.2', params),
    )
  })

  it('ライブラリのバージョンが違えば別の id', () => {
    expect(schedulerConfigId('ts-fsrs', '6.0.0', params)).not.toBe(
      schedulerConfigId('ts-fsrs', '5.4.2', params),
    )
  })
})

describe('toSchedulingSnapshot / snapshotsEqual', () => {
  it('ReviewState から FSRS 部分だけを取り出す', () => {
    const snapshot = toSchedulingSnapshot(makeState({ cardId: 'c1' }))
    expect(Object.keys(snapshot).sort()).toEqual(Object.keys(makeSnapshot()).sort())
    expect(snapshotsEqual(snapshot, makeState({ cardId: 'c1' }))).toBe(true)
  })

  it('日時は値で比較し、どれか 1 項目でも違えば等しくない', () => {
    const a = makeSnapshot()
    expect(snapshotsEqual(a, { ...a, due: new Date(a.due.getTime()) })).toBe(true)
    expect(snapshotsEqual(a, { ...a, due: new Date(a.due.getTime() + 1) })).toBe(false)
    expect(snapshotsEqual(a, { ...a, lastReviewedAt: null })).toBe(false)
    expect(snapshotsEqual(a, { ...a, phase: 'relearning' })).toBe(false)
  })

  it('取り出した日時はコピー（元のオブジェクトと共有しない）', () => {
    const state = makeState({ cardId: 'c1' })
    const snapshot = toSchedulingSnapshot(state)
    snapshot.due.setFullYear(2000)
    expect(state.due.getFullYear()).not.toBe(2000)
  })
})
