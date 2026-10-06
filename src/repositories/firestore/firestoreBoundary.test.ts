// @vitest-environment node
import { Timestamp } from 'firebase/firestore'
import { describe, expect, it } from 'vitest'
import { AppError, defaultAppSettings, rebuildProgress } from '../../domain'
import { makeCard, makeMaterial, makeReviewRecord, T0 } from '../../test/factories'
import { toFirestoreAppError } from './errors'
import { toDate, toFirestoreData } from './serialization'
import {
  parseCard,
  parseMaterial,
  parseProgress,
  parseReviewLog,
  parseReviewState,
  parseSchedulerConfig,
  parseSettings,
} from './validation'

/** 保存した形（Timestamp）→ 読み取り、の往復 */
const roundTrip = (value: object) => toFirestoreData(value)

describe('Date ↔ Timestamp', () => {
  it('Date は Timestamp で保存し、入れ子・配列の中も変換する', () => {
    const data = toFirestoreData({ at: T0, nested: { at: T0, list: [T0] }, none: null })
    expect(data.at).toBeInstanceOf(Timestamp)
    expect((data.nested as { at: unknown }).at).toBeInstanceOf(Timestamp)
    expect((data.nested as { list: unknown[] }).list[0]).toBeInstanceOf(Timestamp)
    expect(data.none).toBeNull()
  })

  it('undefined の項目は保存しない', () => {
    expect(toFirestoreData({ a: 1, b: undefined })).toEqual({ a: 1 })
  })

  it('Timestamp はミリ秒まで Date に戻る', () => {
    const date = new Date('2026-10-06T01:02:03.456Z')
    expect(toDate(Timestamp.fromDate(date))?.getTime()).toBe(date.getTime())
  })

  it('Timestamp 以外は日時として扱わない', () => {
    expect(toDate('2026-10-06')).toBeNull()
    expect(toDate(1_700_000_000_000)).toBeNull()
    expect(toDate(null)).toBeNull()
  })
})

describe('Firestore のデータの検証', () => {
  it('正しいデータはドメイン型に戻る（往復で一致）', () => {
    const material = makeMaterial({ id: 'm1' })
    expect(parseMaterial('m1', roundTrip(material))).toEqual(material)

    const card = makeCard({ id: 'c1', examDifficulty: 2, subcategory: '小分類' })
    expect(parseCard('m1', 'c1', roundTrip(card))).toEqual(card)

    const { state, log } = makeReviewRecord({ cardId: 'c1', logId: 'l1' })
    expect(parseReviewState('m1', 'c1', roundTrip(state))).toEqual(state)
    expect(parseReviewLog('m1', 'l1', roundTrip(log))).toEqual(log)

    const progress = rebuildProgress({ materialId: 'm1', cards: [card], states: [state], now: T0 })
    expect(parseProgress('m1', roundTrip(progress))).toEqual(progress)
  })

  it.each([
    ['必須項目がない', () => parseCard('m1', 'c1', roundTrip({ ...makeCard({ id: 'c1' }), question: undefined }))],
    ['日時が Timestamp でない', () => parseMaterial('m1', { ...roundTrip(makeMaterial({ id: 'm1' })), createdAt: '2026-10-06' })],
    ['ドキュメント id と中身の id が違う', () => parseCard('m1', 'other', roundTrip(makeCard({ id: 'c1' })))],
    ['問題の難易度が 1〜5 の外', () => parseCard('m1', 'c1', roundTrip({ ...makeCard({ id: 'c1' }), examDifficulty: 7 }))],
    [
      'ReviewState の学習段階が不正',
      () => parseReviewState('m1', 'c1', roundTrip({ ...makeReviewRecord({ cardId: 'c1', logId: 'l1' }).state, phase: 'done' })),
    ],
    [
      'ReviewState の評価回数が負',
      () =>
        parseReviewState(
          'm1',
          'c1',
          roundTrip({ ...makeReviewRecord({ cardId: 'c1', logId: 'l1' }).state, ratingCounts: { again: -1, hard: 0, good: 0, easy: 0 } }),
        ),
    ],
    [
      'ReviewLog の評価が不正',
      () => parseReviewLog('m1', 'l1', roundTrip({ ...makeReviewRecord({ cardId: 'c1', logId: 'l1' }).log, rating: 'perfect' })),
    ],
    [
      'ReviewLog の nextState がない',
      () => parseReviewLog('m1', 'l1', roundTrip({ ...makeReviewRecord({ cardId: 'c1', logId: 'l1' }).log, nextState: undefined })),
    ],
    ['データがオブジェクトでない', () => parseMaterial('m1', 'broken')],
  ])('%s → invalid-data（日本語のエラー）', (_label, parse) => {
    let error: unknown
    try {
      parse()
    } catch (e) {
      error = e
    }
    expect(error).toBeInstanceOf(AppError)
    expect(error).toMatchObject({ kind: 'invalid-data' })
    expect((error as AppError).message).toContain('保存されているデータの形式が正しくありません')
  })

  it('設定：保存されていない項目は初期値で補う（古い形式の設定）', () => {
    const settings = parseSettings({ dayStartHour: 5, updatedAt: Timestamp.fromDate(T0) }, T0)
    expect(settings).toEqual({ ...defaultAppSettings(T0), dayStartHour: 5 })
  })

  it('設定：範囲外の値は invalid-data', () => {
    expect(() => parseSettings({ dayStartHour: 24 }, T0)).toThrow(AppError)
    expect(() => parseSettings({ learningSteps: ['10x'] }, T0)).toThrow(AppError)
  })

  it('FSRS 設定の記録', () => {
    const config = {
      id: 'ts-fsrs@5.4.2-00000000',
      library: 'ts-fsrs',
      libraryVersion: '5.4.2',
      params: {
        requestRetention: 0.9,
        maximumInterval: 36500,
        weights: [0.1, 0.2],
        enableFuzz: true,
        enableShortTerm: true,
        learningSteps: ['1m', '10m'] as const,
        relearningSteps: ['10m'] as const,
      },
      createdAt: T0,
    }
    expect(parseSchedulerConfig(config.id, roundTrip(config))).toEqual(config)
  })
})

describe('Firestore のエラー → 日本語の AppError', () => {
  it.each([
    ['permission-denied', 'permission-denied', 'アクセスが拒否されました'],
    ['unauthenticated', 'unauthenticated', 'もう一度ログイン'],
    ['unavailable', 'network', 'サーバーに接続できませんでした'],
    ['deadline-exceeded', 'network', 'サーバーに接続できませんでした'],
    ['aborted', 'conflict', '他の端末の更新と重なった'],
    ['failed-precondition', 'configuration', 'インデックス'],
    ['not-found', 'not-found', '見つかりません'],
    ['resource-exhausted', 'network', '上限'],
    ['internal', 'unknown', '失敗しました'],
  ])('%s → %s', (code, kind, text) => {
    const error = toFirestoreAppError({ code, name: 'FirebaseError', message: `Firebase: ${code}` })
    expect(error).toMatchObject({ kind })
    expect(error.message).toContain(text)
    // Firebase のエラーコードをそのまま表示しない
    expect(error.message).not.toContain(code)
  })

  it('AppError はそのまま', () => {
    const original = new AppError('invalid-data', 'x')
    expect(toFirestoreAppError(original)).toBe(original)
  })
})
