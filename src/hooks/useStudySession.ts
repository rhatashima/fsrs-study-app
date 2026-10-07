import { useCallback, useEffect, useRef, useState } from 'react'
import { useClock } from '../app/clockContext'
import { useRepositories } from '../app/repositoryContext'
import {
  answeredCount,
  isCorruptedReviewStateError,
  nextStudyItem,
  sessionCounts,
  toSchedulingSnapshot,
  type Card,
  type QueueKind,
  type RatingCounts,
  type ReviewRating,
  type ReviewState,
  type StudyCounts,
  type StudySession,
} from '../domain'
import { errorMessage } from '../lib/errorMessage'
import type { RatingPreview } from '../lib/fsrs'
import { createId } from '../lib/id'
import { perfAsync, perfBegin, perfEnd, perfStart } from '../lib/perf'
import type { ReviewRecord } from '../repositories/types'
import { restoreReviewStates } from '../services/restoreService'
import {
  buildReview,
  saveReview,
  selectCurrentMaterial,
  startStudySession,
  type StudyContext,
} from '../services/studyService'

/** 答えを表示したまま、この時間を過ぎたら次回予定（参考値）を計算し直す */
export const PREVIEW_STALE_MS = 60_000

export interface CurrentItem {
  kind: QueueKind
  card: Card
  state: ReviewState | null
}

interface Preview {
  computedAt: Date
  outcomes: RatingPreview
}

/** 学習状態が壊れている・見つからない（履歴から復元できる） */
interface CorruptedState {
  status: 'corrupted'
  materialId: string
  cardIds: readonly string[]
  message: string
  restoring: boolean
  restoreError: string | null
}

export type StudyView =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'no-material' }
  | CorruptedState
  | {
      status: 'studying'
      materialTitle: string
      item: CurrentItem
      counts: StudyCounts
      revealed: boolean
      preview: Preview | null
      saving: boolean
      saveError: string | null
      /** 保存に失敗したレビューを、同じ内容で再送できる */
      canRetrySave: boolean
    }
  | {
      status: 'done'
      materialTitle: string
      answered: RatingCounts
      answeredTotal: number
      nextLearningDueAt: Date | null
      checkedAt: Date
    }

type InternalState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'no-material' }
  | CorruptedState
  | {
      status: 'ready'
      context: StudyContext
      session: StudySession
      item: CurrentItem | null
      /** 今のカードのレビューの id（カードを出したときに 1 回だけ採番。保存の再試行でも同じ id を使う） */
      reviewId: string
      /** 保存に失敗したレビュー（再送用） */
      pendingRecord: ReviewRecord | null
      /** 今のカードを表示した時刻（回答時間の計測用） */
      shownAt: Date
      checkedAt: Date
      revealed: boolean
      preview: Preview | null
      saving: boolean
      saveError: string | null
    }

/** セッションと現在時刻から、次に表示するカードを決める */
function advance(session: StudySession, now: Date) {
  const next = nextStudyItem(session, now)
  return {
    session,
    item: next.kind === 'done' ? null : next,
    reviewId: createId(),
    pendingRecord: null,
    shownAt: now,
    checkedAt: now,
    revealed: false,
    preview: null,
    saving: false,
    saveError: null,
  }
}

/**
 * 学習画面の状態とアクション。
 * - 次回予定（preview）は答えを表示した時点で計算する参考値
 * - 評価の確定時は、ボタンを押した時刻を正式なレビュー日時として計算し直して保存する
 */
export function useStudySession() {
  const repos = useRepositories()
  const clock = useClock()
  const [state, setState] = useState<InternalState>({ status: 'loading' })
  /** 再読み込みのきっかけ（復元の後など） */
  const [loadCount, setLoadCount] = useState(0)
  /** 保存中か（二重押しを同期的に防ぐ） */
  const savingRef = useRef(false)

  const toFailure = useCallback((error: unknown, fallback: string): InternalState => {
    if (isCorruptedReviewStateError(error)) {
      return {
        status: 'corrupted',
        materialId: error.materialId,
        cardIds: error.cardIds,
        message: error.message,
        restoring: false,
        restoreError: null,
      }
    }
    return { status: 'error', message: errorMessage(error, fallback) }
  }, [])

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const material = await perfAsync('study:selectCurrentMaterial', () => selectCurrentMaterial(repos))
        if (!material) {
          if (!cancelled) setState({ status: 'no-material' })
          return
        }
        const now = clock()
        const { context, session } = await perfAsync('study:startStudySession', () =>
          startStudySession(repos, material.id, now),
        )
        if (!cancelled) setState({ status: 'ready', context, ...advance(session, now) })
      } catch (error) {
        if (!cancelled) setState(toFailure(error, '学習データを読み込めませんでした。再読み込みしてください。'))
      }
    })()
    return () => {
      cancelled = true
    }
  }, [repos, clock, toFailure, loadCount])

  const computePreview = useCallback((item: CurrentItem, context: StudyContext): Preview => {
    const now = clock()
    const snapshot = item.state ? toSchedulingSnapshot(item.state) : null
    const done = perfStart('study:preview-compute')
    const outcomes = context.scheduler.preview(snapshot, now)
    done()
    return { computedAt: now, outcomes }
  }, [clock])

  const reveal = useCallback(() => {
    if (state.status !== 'ready' || !state.item || state.revealed) return
    perfBegin('reveal')
    setState({ ...state, revealed: true, preview: computePreview(state.item, state.context) })
  }, [state, computePreview])

  /** 答えを表示したまま時間が経っていたら、次回予定を今の時刻で計算し直す */
  const refreshPreviewIfStale = useCallback(() => {
    if (state.status !== 'ready' || !state.item || !state.preview || state.saving) return
    if (clock().getTime() - state.preview.computedAt.getTime() < PREVIEW_STALE_MS) return
    setState({ ...state, preview: computePreview(state.item, state.context) })
  }, [state, clock, computePreview])

  /** レビュー結果を保存し、成功したら次のカードへ進む。失敗したら同じ結果を再送できるよう残す */
  const commit = useCallback(
    async (ready: Extract<InternalState, { status: 'ready' }>, record: ReviewRecord) => {
      if (savingRef.current) return
      savingRef.current = true
      setState({ ...ready, saving: true, saveError: null, pendingRecord: record })
      try {
        const session = await perfAsync('study:saveReview', () => saveReview(repos, ready.session, record))
        setState({ status: 'ready', context: ready.context, ...advance(session, clock()) })
      } catch (error) {
        if (isCorruptedReviewStateError(error)) {
          setState(toFailure(error, ''))
        } else {
          setState({
            ...ready,
            saving: false,
            pendingRecord: record,
            saveError: errorMessage(error, '保存できませんでした。通信状態を確認して、もう一度保存してください。'),
          })
        }
      } finally {
        savingRef.current = false
      }
    },
    [repos, clock, toFailure],
  )

  const answer = useCallback(
    async (rating: ReviewRating) => {
      if (state.status !== 'ready' || !state.item || !state.revealed || state.saving || state.pendingRecord) return
      perfBegin('rate')
      // 正式なレビュー日時 = ボタンを押した時刻
      const reviewedAt = clock()
      const record = buildReview(
        state.context,
        state.session,
        {
          card: state.item.card,
          rating,
          reviewedAt,
          durationMs: Math.max(0, reviewedAt.getTime() - state.shownAt.getTime()),
        },
        state.reviewId,
      )
      await commit(state, record)
    },
    [state, clock, commit],
  )

  /** 保存に失敗したレビューを、同じ内容（同じ id・評価・日時）で再送する */
  const retrySave = useCallback(async () => {
    if (state.status !== 'ready' || !state.pendingRecord || state.saving) return
    await commit(state, state.pendingRecord)
  }, [state, commit])

  /** 壊れた・見つからない学習状態を履歴から復元し、学習を読み込み直す（利用者が選んだときだけ） */
  const restore = useCallback(async () => {
    if (state.status !== 'corrupted' || state.restoring) return
    setState({ ...state, restoring: true, restoreError: null })
    try {
      const result = await restoreReviewStates(repos, state.materialId, state.cardIds, clock())
      if (result.failed.length > 0) {
        setState({
          ...state,
          restoring: false,
          restoreError: `${result.failed.length} 枚は学習履歴が見つからないため復元できませんでした。`,
        })
        return
      }
      setState({ status: 'loading' })
      setLoadCount((count) => count + 1)
    } catch (error) {
      setState({ ...state, restoring: false, restoreError: errorMessage(error, '復元できませんでした。') })
    }
  }, [state, repos, clock])

  /** 学習中のカードが出題できる時刻になったか確認し直す */
  const checkAgain = useCallback(() => {
    if (state.status !== 'ready') return
    setState({ ...state, ...advance(state.session, clock()) })
  }, [state, clock])

  // 計測：画面に反映された時点（計測が無効なら何もしない）
  // reviewId はカードを出すたびに新しくなる（同じカードの再出題も区別できる）
  const shownReviewId = state.status === 'ready' ? state.reviewId : null
  const revealed = state.status === 'ready' && state.revealed
  useEffect(() => {
    if (shownReviewId === null) return
    perfEnd('study-start', 'study:first-card-shown')
    perfEnd('rate', 'study:next-card-shown')
  }, [shownReviewId])
  useEffect(() => {
    if (revealed) perfEnd('reveal', 'study:preview-shown')
  }, [revealed])

  return { view: toView(state), reveal, answer, retrySave, restore, refreshPreviewIfStale, checkAgain }
}

function toView(state: InternalState): StudyView {
  if (state.status !== 'ready') return state
  const materialTitle = state.context.material.title
  if (!state.item) {
    const next = nextStudyItem(state.session, state.checkedAt)
    return {
      status: 'done',
      materialTitle,
      answered: state.session.answered,
      answeredTotal: answeredCount(state.session),
      nextLearningDueAt: next.kind === 'done' ? next.nextLearningDueAt : null,
      checkedAt: state.checkedAt,
    }
  }
  return {
    status: 'studying',
    materialTitle,
    item: state.item,
    counts: sessionCounts(state.session, state.shownAt),
    revealed: state.revealed,
    preview: state.preview,
    saving: state.saving,
    saveError: state.saveError,
    canRetrySave: state.pendingRecord !== null && !state.saving,
  }
}
