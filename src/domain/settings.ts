import { DEFAULT_DAY_START_HOUR } from './date'
import type { StepDuration } from './scheduling'

/**
 * 利用者の設定（全教材共通）。
 * FSRS の設定値はライブラリの暗黙の既定値に頼らず、アプリの初期値として明示する（defaultAppSettings）。
 * 例外は fsrsWeights の null（＝ライブラリが提供するモデルの既定の重み）。
 * 実際に計算に使った値は、正規化後の値が SchedulerConfig に記録される。
 */
export interface AppSettings {
  dayStartHour: number
  requestRetention: number
  maximumInterval: number
  enableFuzz: boolean
  enableShortTerm: boolean
  learningSteps: StepDuration[]
  relearningSteps: StepDuration[]
  /** null ならライブラリの既定の重み（将来、最適化した重みを保存する） */
  fsrsWeights: number[] | null
  /** 現在の設定に対応する SchedulerConfig の id（未作成なら null） */
  activeSchedulerConfigId: string | null
  lastMaterialId: string | null
  updatedAt: Date
}

/** FSRS の初期設定 */
export const DEFAULT_FSRS_SETTINGS = {
  requestRetention: 0.9,
  maximumInterval: 36500,
  enableFuzz: true,
  enableShortTerm: true,
  learningSteps: ['1m', '10m'],
  relearningSteps: ['10m'],
} as const satisfies Pick<
  AppSettings,
  'requestRetention' | 'maximumInterval' | 'enableFuzz' | 'enableShortTerm'
> & { learningSteps: readonly StepDuration[]; relearningSteps: readonly StepDuration[] }

export function defaultAppSettings(now: Date): AppSettings {
  return {
    dayStartHour: DEFAULT_DAY_START_HOUR,
    requestRetention: DEFAULT_FSRS_SETTINGS.requestRetention,
    maximumInterval: DEFAULT_FSRS_SETTINGS.maximumInterval,
    enableFuzz: DEFAULT_FSRS_SETTINGS.enableFuzz,
    enableShortTerm: DEFAULT_FSRS_SETTINGS.enableShortTerm,
    learningSteps: [...DEFAULT_FSRS_SETTINGS.learningSteps],
    relearningSteps: [...DEFAULT_FSRS_SETTINGS.relearningSteps],
    fsrsWeights: null,
    activeSchedulerConfigId: null,
    lastMaterialId: null,
    updatedAt: now,
  }
}
