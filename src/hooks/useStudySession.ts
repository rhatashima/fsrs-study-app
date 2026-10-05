import { useCallback, useEffect, useState } from 'react'
import { useClock } from '../app/clockContext'
import { useRepositories } from '../app/repositoryContext'
import {
  answeredCount,
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
import {
  selectCurrentMaterial,
  startStudySession,
  submitReview,
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

export type StudyView =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'no-material' }
  | {
      status: 'studying'
      materialTitle: string
      item: CurrentItem
      counts: StudyCounts
      revealed: boolean
      preview: Preview | null
      saving: boolean
      saveError: string | null
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
  | {
      status: 'ready'
      context: StudyContext
      session: StudySession
      item: CurrentItem | null
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

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const material = await selectCurrentMaterial(repos)
        if (!material) {
          if (!cancelled) setState({ status: 'no-material' })
          return
        }
        const now = clock()
        const { context, session } = await startStudySession(repos, material.id, now)
        if (!cancelled) setState({ status: 'ready', context, ...advance(session, now) })
      } catch (error) {
        if (!cancelled) {
          setState({
            status: 'error',
            message: errorMessage(error, '学習データを読み込めませんでした。再読み込みしてください。'),
          })
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [repos, clock])

  const computePreview = useCallback((item: CurrentItem, context: StudyContext): Preview => {
    const now = clock()
    const snapshot = item.state ? toSchedulingSnapshot(item.state) : null
    return { computedAt: now, outcomes: context.scheduler.preview(snapshot, now) }
  }, [clock])

  const reveal = useCallback(() => {
    if (state.status !== 'ready' || !state.item || state.revealed) return
    setState({ ...state, revealed: true, preview: computePreview(state.item, state.context) })
  }, [state, computePreview])

  /** 答えを表示したまま時間が経っていたら、次回予定を今の時刻で計算し直す */
  const refreshPreviewIfStale = useCallback(() => {
    if (state.status !== 'ready' || !state.item || !state.preview || state.saving) return
    if (clock().getTime() - state.preview.computedAt.getTime() < PREVIEW_STALE_MS) return
    setState({ ...state, preview: computePreview(state.item, state.context) })
  }, [state, clock, computePreview])

  const answer = useCallback(
    async (rating: ReviewRating) => {
      if (state.status !== 'ready' || !state.item || !state.revealed || state.saving) return
      const { context, session, item, shownAt } = state
      // 正式なレビュー日時 = ボタンを押した時刻
      const reviewedAt = clock()
      setState({ ...state, saving: true, saveError: null })
      try {
        const result = await submitReview(repos, context, session, {
          card: item.card,
          rating,
          reviewedAt,
          durationMs: Math.max(0, reviewedAt.getTime() - shownAt.getTime()),
        })
        setState({ status: 'ready', context, ...advance(result.session, clock()) })
      } catch (error) {
        setState({
          ...state,
          saving: false,
          saveError: errorMessage(error, '保存できませんでした。もう一度押してください。'),
        })
      }
    },
    [state, repos, clock],
  )

  /** 学習中のカードが出題できる時刻になったか確認し直す */
  const checkAgain = useCallback(() => {
    if (state.status !== 'ready') return
    setState({ ...state, ...advance(state.session, clock()) })
  }, [state, clock])

  return { view: toView(state), reveal, answer, refreshPreviewIfStale, checkAgain }
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
  }
}
