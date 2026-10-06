import {
  AppError,
  applyAnswer,
  CorruptedReviewStateError,
  countStudyItems,
  createStudySession,
  remainingNewCardsToday,
  studyDayEnd,
  toDayKey,
  type AppSettings,
  type Card,
  type ReviewRating,
  type StudyCounts,
  type StudyMaterial,
  type StudySession,
} from '../domain'
import { createFsrsScheduler, type FsrsScheduler } from '../lib/fsrs'
import { createId } from '../lib/id'
import type { Repositories, ReviewRecord } from '../repositories/types'
import { reviewCard } from './reviewService'

/*
 * 学習の流れ（リポジトリ・FSRS・ドメインの組み合わせ）。React に依存しない。
 * 時刻はすべて引数で受け取る（テストで固定できるように）。
 */

/** 選択中の教材：前回選んだ教材、なければ最初の有効な教材 */
export async function selectCurrentMaterial(repos: Repositories): Promise<StudyMaterial | null> {
  const [settings, materials] = await Promise.all([repos.settings.getSettings(), repos.materials.list()])
  const active = materials.filter((material) => material.isActive)
  return active.find((material) => material.id === settings.lastMaterialId) ?? active[0] ?? null
}

async function requireMaterial(repos: Repositories, materialId: string): Promise<StudyMaterial> {
  const material = await repos.materials.get(materialId)
  if (!material) throw new AppError('not-found', '教材が見つかりません。')
  return material
}

/**
 * 現在の設定で FSRS スケジューラーを作り、その設定の記録（SchedulerConfig）を保存しておく。
 * 設定が前回と同じなら何も書き込まない。
 */
export async function prepareScheduler(
  repos: Repositories,
  settings: AppSettings,
  now: Date,
): Promise<FsrsScheduler> {
  const scheduler = createFsrsScheduler(settings, now)
  const configId = scheduler.config.id
  if (settings.activeSchedulerConfigId !== configId) {
    if (!(await repos.settings.getSchedulerConfig(configId))) {
      await repos.settings.saveSchedulerConfig(scheduler.config)
    }
    await repos.settings.saveSettings({ ...settings, activeSchedulerConfigId: configId, updatedAt: now })
  }
  return scheduler
}

/**
 * 新規カードを order 順に needed 枚まで集める。
 * 候補のうち ReviewState があるもの（端末間の同時操作などでカーソルがずれた場合）は除き、足りなければ続きを取る。
 * ReviewState がないのに ReviewLog があるカード（状態の欠落）は新規として出さず、CorruptedReviewStateError にする
 * （新規として学習すると、過去の履歴とつながらない状態で上書きしてしまうため）。
 */
async function findNewCards(
  repos: Repositories,
  materialId: string,
  afterOrder: number,
  needed: number,
): Promise<Card[]> {
  const found: Card[] = []
  let cursor = afterOrder
  for (let attempt = 0; attempt < 10 && found.length < needed; attempt++) {
    const limit = needed - found.length
    const candidates = await repos.cards.listNewCandidates(materialId, { afterOrder: cursor, limit })
    if (candidates.length === 0) break
    const studied = new Set(
      (await repos.reviews.getStates(materialId, candidates.map((card) => card.id))).map((s) => s.cardId),
    )
    const unstudied = candidates.filter((card) => !studied.has(card.id))
    const missingStates = await repos.reviews.findCardsWithLogs(
      materialId,
      unstudied.map((card) => card.id),
    )
    if (missingStates.length > 0) throw new CorruptedReviewStateError(materialId, missingStates)
    found.push(...unstudied)
    cursor = candidates[candidates.length - 1]?.order ?? cursor
    if (candidates.length < limit) break
  }
  return found
}

export interface StudyOverview {
  material: StudyMaterial
  counts: StudyCounts
}

/** ホーム画面用：今日の復習数・学習中で今出せる数・新規数（カードの内容は読まない） */
export async function loadStudyOverview(
  repos: Repositories,
  materialId: string,
  now: Date,
): Promise<StudyOverview> {
  const [material, settings, progress] = await Promise.all([
    requireMaterial(repos, materialId),
    repos.settings.getSettings(),
    repos.reviews.getProgress(materialId),
  ])
  const dayEnd = studyDayEnd(now, settings.dayStartHour)
  const dueStates = await repos.reviews.listDue(materialId, { dueBefore: dayEnd })
  const newAvailable = remainingNewCardsToday(
    progress,
    material.newCardsPerDay,
    toDayKey(now, settings.dayStartHour),
  )
  return { material, counts: countStudyItems(dueStates, newAvailable, now, dayEnd) }
}

/** 学習セッションに必要なもの一式 */
export interface StudyContext {
  material: StudyMaterial
  scheduler: FsrsScheduler
  dayStartHour: number
}

/** 学習を始める：今日の学習日内に期限が来るカードと、今日の新規カードだけを読み込む */
export async function startStudySession(
  repos: Repositories,
  materialId: string,
  now: Date,
): Promise<{ context: StudyContext; session: StudySession }> {
  const [material, settings, progress] = await Promise.all([
    requireMaterial(repos, materialId),
    repos.settings.getSettings(),
    repos.reviews.getProgress(materialId),
  ])
  const scheduler = await prepareScheduler(repos, settings, now)
  const dayEnd = studyDayEnd(now, settings.dayStartHour)

  const dueStates = await repos.reviews.listDue(materialId, { dueBefore: dayEnd })
  const dueCards = await repos.cards.getByIds(
    materialId,
    dueStates.map((state) => state.cardId),
  )
  const newLimit = remainingNewCardsToday(
    progress,
    material.newCardsPerDay,
    toDayKey(now, settings.dayStartHour),
  )
  const newCards = await findNewCards(repos, materialId, progress.newCursorOrder, newLimit)

  return {
    context: { material, scheduler, dayStartHour: settings.dayStartHour },
    session: createStudySession({ materialId, dayEnd, dueStates, dueCards, newCards }),
  }
}

export interface SubmitReviewInput {
  card: Card
  rating: ReviewRating
  /** 評価ボタンを押した時刻（正式なレビュー日時） */
  reviewedAt: Date
  durationMs: number | null
}

/**
 * 評価から、保存するレビュー結果を作る（保存はしない）。
 * logId は画面にカードを出したときに 1 回だけ採番し、保存の再試行では同じ結果をそのまま送る（二重登録の防止）。
 */
export function buildReview(
  context: StudyContext,
  session: StudySession,
  input: SubmitReviewInput,
  logId: string,
): ReviewRecord {
  return reviewCard({
    scheduler: context.scheduler,
    card: input.card,
    current: session.states[input.card.id] ?? null,
    rating: input.rating,
    reviewedAt: input.reviewedAt,
    logId,
    durationMs: input.durationMs,
    dayStartHour: context.dayStartHour,
  })
}

/** レビュー結果を保存してからセッションに反映する（同じ結果の再送は冪等） */
export async function saveReview(
  repos: Repositories,
  session: StudySession,
  record: ReviewRecord,
): Promise<StudySession> {
  await repos.reviews.recordReview(record)
  return applyAnswer(session, record.state, record.log.rating)
}

/** 評価を確定する：次の状態を計算し、ReviewState・ReviewLog・集計を保存してからセッションに反映する */
export async function submitReview(
  repos: Repositories,
  context: StudyContext,
  session: StudySession,
  input: SubmitReviewInput,
  logId: string = createId(),
): Promise<{ session: StudySession; record: ReviewRecord }> {
  const record = buildReview(context, session, input, logId)
  return { session: await saveReview(repos, session, record), record }
}
