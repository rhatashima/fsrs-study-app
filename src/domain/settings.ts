import { DEFAULT_DAY_START_HOUR } from './date'
import type { StepDuration } from './scheduling'

/**
 * 利用者の設定（全教材共通）。
 * null の FSRS 項目は「ライブラリの既定値を使う」意味（既定値の解決は src/lib/fsrs/ が行う）。
 */
export interface AppSettings {
  dayStartHour: number
  requestRetention: number
  maximumInterval: number
  enableFuzz: boolean
  fsrsWeights: number[] | null
  learningSteps: StepDuration[] | null
  relearningSteps: StepDuration[] | null
  /** 現在の設定に対応する SchedulerConfig の id（未作成なら null） */
  activeSchedulerConfigId: string | null
  lastMaterialId: string | null
  updatedAt: Date
}

export function defaultAppSettings(now: Date): AppSettings {
  return {
    dayStartHour: DEFAULT_DAY_START_HOUR,
    requestRetention: 0.9,
    maximumInterval: 36500,
    enableFuzz: true,
    fsrsWeights: null,
    learningSteps: null,
    relearningSteps: null,
    activeSchedulerConfigId: null,
    lastMaterialId: null,
    updatedAt: now,
  }
}
