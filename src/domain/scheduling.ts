/**
 * FSRS に由来する概念をアプリ側の型で表したもの。
 * ts-fsrs の型・enum は使わない（変換は src/lib/fsrs/ のアダプターが行う）。
 */

/** 学習段階（ts-fsrs の State: New / Learning / Review / Relearning に対応） */
export const LEARNING_PHASES = ['new', 'learning', 'review', 'relearning'] as const
export type LearningPhase = (typeof LEARNING_PHASES)[number]

/**
 * ある時点の FSRS の状態。ReviewState の FSRS 部分と、ReviewLog の previousState / nextState で共通。
 * ts-fsrs v5 の Card から、v6 で削除予定の elapsed_days を除いたもの
 * （経過日数は lastReviewedAt から求められる）。
 */
export interface SchedulingSnapshot {
  phase: LearningPhase
  /** 次回の復習予定日時 */
  due: Date
  /** FSRS の安定度（記憶がどれくらい持つか） */
  stability: number
  /** FSRS が計算する記憶の難易度。Card.examDifficulty（問題の難易度）とは別物 */
  difficulty: number
  scheduledDays: number
  /** 学習ステップ（数分後の再出題）の何段目か */
  learningSteps: number
  reps: number
  lapses: number
  lastReviewedAt: Date | null
}

const SNAPSHOT_KEYS = [
  'phase',
  'due',
  'stability',
  'difficulty',
  'scheduledDays',
  'learningSteps',
  'reps',
  'lapses',
  'lastReviewedAt',
] as const satisfies readonly (keyof SchedulingSnapshot)[]

/** ReviewState など SchedulingSnapshot を含むオブジェクトから、FSRS 部分だけを取り出す */
export function toSchedulingSnapshot(source: SchedulingSnapshot): SchedulingSnapshot {
  return {
    phase: source.phase,
    due: new Date(source.due),
    stability: source.stability,
    difficulty: source.difficulty,
    scheduledDays: source.scheduledDays,
    learningSteps: source.learningSteps,
    reps: source.reps,
    lapses: source.lapses,
    lastReviewedAt: source.lastReviewedAt ? new Date(source.lastReviewedAt) : null,
  }
}

export function snapshotsEqual(a: SchedulingSnapshot, b: SchedulingSnapshot): boolean {
  return SNAPSHOT_KEYS.every((key) => {
    const x = a[key]
    const y = b[key]
    if (x instanceof Date || y instanceof Date) {
      return x instanceof Date && y instanceof Date && x.getTime() === y.getTime()
    }
    return x === y
  })
}

/** 学習ステップの長さ（例 "1m", "10m", "1h", "1d"） */
export type StepDuration = `${number}${'m' | 'h' | 'd'}`

/** スケジューラーに渡す FSRS パラメータ（すべての値が確定したもの） */
export interface FsrsParams {
  requestRetention: number
  maximumInterval: number
  weights: readonly number[]
  enableFuzz: boolean
  enableShortTerm: boolean
  learningSteps: readonly StepDuration[]
  relearningSteps: readonly StepDuration[]
}

/**
 * FSRS 設定の記録（不変）。どのライブラリ・バージョン・パラメータで計算したかを後から追跡するために残す。
 * ReviewLog / ReviewState はこの id を参照する。
 */
export interface SchedulerConfig {
  readonly id: string
  /** 例 "ts-fsrs" */
  readonly library: string
  /** 例 "5.4.2" */
  readonly libraryVersion: string
  readonly params: Readonly<FsrsParams>
  readonly createdAt: Date
}

/** ReviewLog に埋め込む、計算に使った設定への参照（設定ドキュメントがなくてもバージョンが分かるように） */
export interface SchedulerRef {
  readonly configId: string
  readonly library: string
  readonly libraryVersion: string
}

export function toSchedulerRef(config: SchedulerConfig): SchedulerRef {
  return { configId: config.id, library: config.library, libraryVersion: config.libraryVersion }
}

/**
 * ライブラリ・バージョン・パラメータから決まる設定 id（例 "ts-fsrs@5.4.2-1a2b3c4d"）。
 * 同じ設定なら常に同じ id になるので、設定を変えたときだけ新しい記録が増える。
 */
export function schedulerConfigId(library: string, libraryVersion: string, params: FsrsParams): string {
  const canonical = JSON.stringify([
    params.requestRetention,
    params.maximumInterval,
    params.weights,
    params.enableFuzz,
    params.enableShortTerm,
    params.learningSteps,
    params.relearningSteps,
  ])
  return `${library}@${libraryVersion}-${fnv1a32(canonical)}`
}

/** 32bit FNV-1a ハッシュ（暗号用途ではない。設定の識別にだけ使う） */
function fnv1a32(text: string): string {
  let hash = 0x811c9dc5
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0).toString(16).padStart(8, '0')
}
