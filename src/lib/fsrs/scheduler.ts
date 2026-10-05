import { createEmptyCard, fsrs, FSRSVersion, generatorParameters, type FSRS } from 'ts-fsrs'
import {
  REVIEW_RATINGS,
  schedulerConfigId,
  type AppSettings,
  type LearningPhase,
  type ReviewRating,
  type SchedulerConfig,
  type SchedulingSnapshot,
} from '../../domain'
import { fromFsrsCard, fromFsrsParameters, toFsrsCard, toFsrsRating } from './adapter'

export const FSRS_LIBRARY = 'ts-fsrs'

/**
 * 実行中の ts-fsrs のバージョン（例 "5.4.2"）。ライブラリ自身が公開する FSRSVersion
 * （"v5.4.2 using FSRS-6.0" の形式）から取り出すので、インストールされている実物と必ず一致する。
 */
export const FSRS_LIBRARY_VERSION = parseLibraryVersion(FSRSVersion)

export function parseLibraryVersion(fsrsVersion: string): string {
  const match = /^v?(\d+\.\d+\.\d+)/.exec(fsrsVersion)
  if (!match?.[1]) throw new Error(`Unexpected ts-fsrs version string: ${fsrsVersion}`)
  return match[1]
}

/** 4 評価それぞれを選んだ場合の結果（表示用の参考値） */
export type RatingPreview = Record<ReviewRating, { due: Date; phase: LearningPhase; scheduledDays: number }>

/** アプリから使う FSRS スケジューラー。入出力はドメイン型だけ */
export interface FsrsScheduler {
  /** 計算に使う設定（ts-fsrs が正規化した後の値） */
  readonly config: SchedulerConfig
  /** 新規カードの初期状態（ts-fsrs の createEmptyCard） */
  newSnapshot(now: Date): SchedulingSnapshot
  /** current が null なら新規カードとして、4 評価それぞれの次の状態を計算する（保存はしない） */
  preview(current: SchedulingSnapshot | null, now: Date): RatingPreview
  /** current が null なら新規カードとして、rating を選んだ後の状態を計算する */
  apply(current: SchedulingSnapshot | null, rating: ReviewRating, now: Date): SchedulingSnapshot
}

/**
 * 設定から ts-fsrs のパラメータを作る。ライブラリの暗黙の既定値には頼らず、AppSettings の値をすべて渡す
 * （重みが null のときだけライブラリ既定の重みを使う）。generatorParameters が正規化した値を返す。
 */
function resolveParameters(settings: AppSettings) {
  return generatorParameters({
    request_retention: settings.requestRetention,
    maximum_interval: settings.maximumInterval,
    enable_fuzz: settings.enableFuzz,
    enable_short_term: settings.enableShortTerm,
    learning_steps: [...settings.learningSteps],
    relearning_steps: [...settings.relearningSteps],
    ...(settings.fsrsWeights ? { w: [...settings.fsrsWeights] } : {}),
  })
}

export function createFsrsScheduler(settings: AppSettings, now: Date): FsrsScheduler {
  const engine: FSRS = fsrs(resolveParameters(settings))
  // 実際に計算に使うのは engine が保持するパラメータ（正規化後）なので、それを記録する
  const params = fromFsrsParameters(engine.parameters)
  const config: SchedulerConfig = {
    id: schedulerConfigId(FSRS_LIBRARY, FSRS_LIBRARY_VERSION, params),
    library: FSRS_LIBRARY,
    libraryVersion: FSRS_LIBRARY_VERSION,
    params,
    createdAt: now,
  }

  const toCard = (current: SchedulingSnapshot | null, now: Date) =>
    current ? toFsrsCard(current) : createEmptyCard(now)

  return {
    config,
    newSnapshot: (now) => fromFsrsCard(createEmptyCard(now)),
    preview(current, now) {
      const outcomes = engine.repeat(toCard(current, now), now)
      const entries = REVIEW_RATINGS.map((rating) => {
        const next = fromFsrsCard(outcomes[toFsrsRating(rating)].card)
        return [rating, { due: next.due, phase: next.phase, scheduledDays: next.scheduledDays }] as const
      })
      return Object.fromEntries(entries) as RatingPreview
    },
    apply(current, rating, now) {
      return fromFsrsCard(engine.next(toCard(current, now), now, toFsrsRating(rating)).card)
    },
  }
}
