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
  type MaterialProgress,
  type ReviewRating,
  type ReviewState,
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

/*
 * 学習データの読み込み。Firestore の往復を減らすため、依存関係に沿って段ごとにまとめて並列に読む。
 *
 *   段 1：設定 ∥ 教材一覧                      （どちらも独立）
 *   段 2：集計 ∥ 期限カードの学習状態            （教材と設定だけに依存。互いに独立）
 *   段 3：期限カードの本文 ∥ 新規候補 ∥ FSRS 設定の記録（本文は期限カードの結果、新規候補は集計のカーソルに依存）
 *   段 4：新規候補の学習状態 ∥ 新規候補の学習履歴の有無（どちらも新規候補だけに依存）
 *
 * ホーム画面は段 1〜2（StudyBasics）だけを読む。直後に学習を始める場合は、それを再利用して段 3〜4 だけを読む。
 */

/** 選択中の教材：前回選んだ教材、なければ最初の有効な教材 */
function pickMaterial(settings: AppSettings, materials: readonly StudyMaterial[]): StudyMaterial | null {
  const active = materials.filter((material) => material.isActive)
  return active.find((material) => material.id === settings.lastMaterialId) ?? active[0] ?? null
}

export async function selectCurrentMaterial(repos: Repositories): Promise<StudyMaterial | null> {
  const [settings, materials] = await Promise.all([repos.settings.getSettings(), repos.materials.list()])
  return pickMaterial(settings, materials)
}

/** ホーム画面と学習開始の両方で使う、教材ごとの基本データ（段 1〜2） */
export interface StudyBasics {
  settings: AppSettings
  material: StudyMaterial
  progress: MaterialProgress
  /** 今日の学習日の終わりより前が期限の学習状態（復習・学習中） */
  dueStates: ReviewState[]
  /** 読み込んだときの学習日の終わり */
  dayEnd: Date
  /** 読み込んだ時刻 */
  loadedAt: Date
}

/** 段 2：集計と期限カードの学習状態（どちらも教材と設定だけに依存し、互いに独立） */
async function loadMaterialState(
  repos: Repositories,
  settings: AppSettings,
  material: StudyMaterial,
  now: Date,
): Promise<StudyBasics> {
  const dayEnd = studyDayEnd(now, settings.dayStartHour)
  const [progress, dueStates] = await Promise.all([
    repos.reviews.getProgress(material.id),
    repos.reviews.listDue(material.id, { dueBefore: dayEnd }),
  ])
  return { settings, material, progress, dueStates, dayEnd, loadedAt: now }
}

/** 選択中の教材の基本データ（段 1 → 段 2）。教材がなければ null */
export async function loadStudyBasics(repos: Repositories, now: Date): Promise<StudyBasics | null> {
  const [settings, materials] = await Promise.all([repos.settings.getSettings(), repos.materials.list()])
  const material = pickMaterial(settings, materials)
  return material ? loadMaterialState(repos, settings, material, now) : null
}

/** 指定した教材の基本データ（段 1 → 段 2） */
export async function loadStudyBasicsFor(repos: Repositories, materialId: string, now: Date): Promise<StudyBasics> {
  const [settings, material] = await Promise.all([repos.settings.getSettings(), repos.materials.get(materialId)])
  if (!material) throw new AppError('not-found', '教材が見つかりません。')
  return loadMaterialState(repos, settings, material, now)
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
 * 新規候補から、今日の新規カードを order 順に needed 枚まで集める（段 4。続きが必要な場合だけ追加で読む）。
 * - 候補のうち ReviewState があるもの（端末間の同時操作などでカーソルがずれた場合）は除き、足りなければ続きを取る
 * - ReviewState がないのに ReviewLog があるカード（状態の欠落）は新規として出さず、CorruptedReviewStateError にする
 *   （新規として学習すると、過去の履歴とつながらない状態で上書きしてしまうため）
 */
async function collectNewCards(
  repos: Repositories,
  materialId: string,
  firstCandidates: Card[],
  afterOrder: number,
  needed: number,
): Promise<Card[]> {
  const found: Card[] = []
  let candidates = firstCandidates
  let requested = needed
  let cursor = afterOrder
  for (let attempt = 0; attempt < 10 && candidates.length > 0; attempt++) {
    const ids = candidates.map((card) => card.id)
    // 学習状態の有無と、学習履歴の有無は互いに独立なので同時に読む
    const [states, withLogs] = await Promise.all([
      repos.reviews.getStates(materialId, ids),
      repos.reviews.findCardsWithLogs(materialId, ids),
    ])
    const studied = new Set(states.map((state) => state.cardId))
    const missingStates = withLogs.filter((id) => !studied.has(id))
    if (missingStates.length > 0) throw new CorruptedReviewStateError(materialId, missingStates)
    found.push(...candidates.filter((card) => !studied.has(card.id)))
    cursor = candidates[candidates.length - 1]?.order ?? cursor
    if (found.length >= needed || candidates.length < requested) break
    requested = needed - found.length
    candidates = await repos.cards.listNewCandidates(materialId, { afterOrder: cursor, limit: requested })
  }
  return found.slice(0, needed)
}

export interface StudyOverview {
  material: StudyMaterial
  counts: StudyCounts
}

/** ホーム画面の件数（読み込み済みの基本データから計算する。通信しない） */
export function overviewOf(basics: StudyBasics, now: Date): StudyOverview {
  const { settings, material, progress, dueStates, dayEnd } = basics
  const newAvailable = remainingNewCardsToday(progress, material.newCardsPerDay, toDayKey(now, settings.dayStartHour))
  return { material, counts: countStudyItems(dueStates, newAvailable, now, dayEnd) }
}

/** ホーム画面用：今日の復習数・学習中で今出せる数・新規数（カードの内容は読まない） */
export async function loadStudyOverview(
  repos: Repositories,
  materialId: string,
  now: Date,
): Promise<StudyOverview> {
  return overviewOf(await loadStudyBasicsFor(repos, materialId, now), now)
}

/** 学習セッションに必要なもの一式 */
export interface StudyContext {
  material: StudyMaterial
  scheduler: FsrsScheduler
  dayStartHour: number
}

/**
 * 基本データ（段 1〜2）から学習を始める（段 3 → 段 4）。
 * 今日の学習日内に期限が来るカードと、今日の新規カードだけを読み込む。
 */
export async function startStudySessionFrom(
  repos: Repositories,
  basics: StudyBasics,
  now: Date,
): Promise<{ context: StudyContext; session: StudySession }> {
  const { settings, material, progress, dueStates, dayEnd } = basics
  const newLimit = remainingNewCardsToday(progress, material.newCardsPerDay, toDayKey(now, settings.dayStartHour))
  // 段 3：期限カードの本文・新規候補・FSRS 設定の記録は互いに独立
  const [scheduler, dueCards, firstCandidates] = await Promise.all([
    prepareScheduler(repos, settings, now),
    repos.cards.getByIds(
      material.id,
      dueStates.map((state) => state.cardId),
    ),
    repos.cards.listNewCandidates(material.id, { afterOrder: progress.newCursorOrder, limit: newLimit }),
  ])
  // 段 4
  const newCards = await collectNewCards(repos, material.id, firstCandidates, progress.newCursorOrder, newLimit)

  return {
    context: { material, scheduler, dayStartHour: settings.dayStartHour },
    session: createStudySession({ materialId: material.id, dayEnd, dueStates, dueCards, newCards }),
  }
}

/** 学習を始める（指定した教材。段 1〜4） */
export async function startStudySession(
  repos: Repositories,
  materialId: string,
  now: Date,
): Promise<{ context: StudyContext; session: StudySession }> {
  return startStudySessionFrom(repos, await loadStudyBasicsFor(repos, materialId, now), now)
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
