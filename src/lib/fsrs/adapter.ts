import {
  Rating,
  State,
  type Card as FsrsCard,
  type FSRSParameters,
  type Grade,
} from 'ts-fsrs'
import type { FsrsParams, LearningPhase, ReviewRating, SchedulingSnapshot } from '../../domain'

/*
 * ドメイン型 ↔ ts-fsrs の型の変換。ts-fsrs の型・enum はこのディレクトリの外に出さない。
 * 変換だけを行い、FSRS の計算はしない（計算は ts-fsrs に任せる）。
 */

const RATING_TO_FSRS = {
  again: Rating.Again,
  hard: Rating.Hard,
  good: Rating.Good,
  easy: Rating.Easy,
} as const satisfies Record<ReviewRating, Grade>

const PHASE_TO_FSRS = {
  new: State.New,
  learning: State.Learning,
  review: State.Review,
  relearning: State.Relearning,
} as const satisfies Record<LearningPhase, State>

export function toFsrsRating(rating: ReviewRating): Grade {
  return RATING_TO_FSRS[rating]
}

export function fromFsrsRating(grade: Grade): ReviewRating {
  const entry = Object.entries(RATING_TO_FSRS).find(([, value]) => value === grade)
  if (!entry) throw new Error(`Unknown ts-fsrs rating: ${String(grade)}`)
  return entry[0] as ReviewRating
}

export function toFsrsState(phase: LearningPhase): State {
  return PHASE_TO_FSRS[phase]
}

export function fromFsrsState(state: State): LearningPhase {
  const entry = Object.entries(PHASE_TO_FSRS).find(([, value]) => value === state)
  if (!entry) throw new Error(`Unknown ts-fsrs state: ${String(state)}`)
  return entry[0] as LearningPhase
}

/**
 * SchedulingSnapshot → ts-fsrs の Card。
 * elapsed_days（v6 で削除予定）は ts-fsrs が last_review とレビュー日時から計算し直すため 0 を渡す。
 */
export function toFsrsCard(snapshot: SchedulingSnapshot): FsrsCard {
  return {
    due: new Date(snapshot.due),
    stability: snapshot.stability,
    difficulty: snapshot.difficulty,
    elapsed_days: 0,
    scheduled_days: snapshot.scheduledDays,
    learning_steps: snapshot.learningSteps,
    reps: snapshot.reps,
    lapses: snapshot.lapses,
    state: toFsrsState(snapshot.phase),
    ...(snapshot.lastReviewedAt ? { last_review: new Date(snapshot.lastReviewedAt) } : {}),
  }
}

/** ts-fsrs の Card → SchedulingSnapshot */
export function fromFsrsCard(card: FsrsCard): SchedulingSnapshot {
  return {
    phase: fromFsrsState(card.state),
    due: new Date(card.due),
    stability: card.stability,
    difficulty: card.difficulty,
    scheduledDays: card.scheduled_days,
    learningSteps: card.learning_steps,
    reps: card.reps,
    lapses: card.lapses,
    lastReviewedAt: card.last_review ? new Date(card.last_review) : null,
  }
}

export function fromFsrsParameters(params: FSRSParameters): FsrsParams {
  return {
    requestRetention: params.request_retention,
    maximumInterval: params.maximum_interval,
    weights: [...params.w],
    enableFuzz: params.enable_fuzz,
    enableShortTerm: params.enable_short_term,
    learningSteps: [...params.learning_steps],
    relearningSteps: [...params.relearning_steps],
  }
}
