import { useCallback, useEffect, useRef, useState } from 'react'
import { useClock } from '../app/clockContext'
import { useRepositories } from '../app/repositoryContext'
import { useStudyHandoff } from '../app/studyHandoffContext'
import {
  answeredCount,
  applyAnswer,
  isAppError,
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
import { buildReview, loadStudyBasics, startStudySessionFrom, type StudyContext } from '../services/studyService'

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

/**
 * 保存待ちのレビュー（常に最大 1 件）。
 * - saving：保存中（Firestore のトランザクション）
 * - failed：保存に失敗（同じ内容で再送できる）
 * - conflict：別の端末などで先に学習状態が更新されていた（再送せず、最新の状態を読み込み直す）
 */
export type PendingStatus = 'saving' | 'failed' | 'conflict'

export interface PendingReview {
  /** 保存する内容（review id・カード・評価・日時・前後の状態など）。再送でもこの内容をそのまま使う */
  record: ReviewRecord
  status: PendingStatus
  message: string | null
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

/** 画面に出す、保存待ちのレビューの状態 */
export interface PendingView {
  status: PendingStatus
  message: string | null
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
      /** 保存済みのレビューだけを反映した件数 */
      counts: StudyCounts
      revealed: boolean
      preview: Preview | null
      /** 前の回答の保存状態（保存待ちがなければ null） */
      pending: PendingView | null
      /** 評価できるか（前の回答の保存が終わるまでは評価できない） */
      canRate: boolean
    }
  | {
      status: 'done'
      materialTitle: string
      /** 保存済みのレビューだけを数える */
      answered: RatingCounts
      answeredTotal: number
      nextLearningDueAt: Date | null
      checkedAt: Date
      pending: PendingView | null
    }

interface ReadyState {
  status: 'ready'
  context: StudyContext
  /** 保存が完了したレビューだけを反映したセッション */
  committed: StudySession
  /** 保存待ちのレビュー（最大 1 件） */
  pending: PendingReview | null
  /** 表示中のカード（null なら出せるカードがない、または保存待ちのカードの再出題を待っている） */
  item: CurrentItem | null
  /** 表示中のカードのレビューの id（カードを出したときに 1 回だけ採番。保存の再試行でも同じ id を使う） */
  reviewId: string
  /** 表示中のカードを表示した時刻（回答時間の計測用） */
  shownAt: Date
  checkedAt: Date
  revealed: boolean
  preview: Preview | null
}

type InternalState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'no-material' }
  | CorruptedState
  | ReadyState

/** 次のカードを選ぶためのセッション：保存済み + 保存待ちのレビュー */
function workingSession(state: Pick<ReadyState, 'committed' | 'pending'>): StudySession {
  const { committed, pending } = state
  return pending ? applyAnswer(committed, pending.record.state, pending.record.log.rating) : committed
}

/**
 * 次に表示するカードを決める（端末内の処理だけ。通信しない）。
 * 保存待ちのカードそのものは、保存が終わるまで出さない。
 */
function advance(session: StudySession, now: Date, pendingCardId: string | null) {
  const next = nextStudyItem(session, now)
  const item = next.kind === 'done' || next.card.id === pendingCardId ? null : next
  return { item, reviewId: createId(), shownAt: now, checkedAt: now, revealed: false, preview: null }
}

const CONFLICT_MESSAGE = '別の端末で学習状態が更新されています。前の回答は保存されていません。最新の状態を読み込み直してください。'

/**
 * 学習画面の状態とアクション。
 * - 次回予定（preview）は答えを表示した時点で計算する参考値
 * - 評価の確定時は、ボタンを押した時刻を正式なレビュー日時として計算する
 * - 評価したら次のカードをすぐ表示し、保存（1 つのトランザクション）は裏で進める。
 *   保存待ちは常に最大 1 件：前の回答の保存が終わるまで、次のカードは評価できない（答えを見ることはできる）
 */
export function useStudySession() {
  const repos = useRepositories()
  const clock = useClock()
  const handoff = useStudyHandoff()
  const [state, setState] = useState<InternalState>({ status: 'loading' })
  /** 再読み込みのきっかけ（復元の後など） */
  const [loadCount, setLoadCount] = useState(0)
  /** 保存待ちのレビューの id（二重押し・同時保存を同期的に防ぐ） */
  const pendingIdRef = useRef<string | null>(null)

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
        const now = clock()
        // ホーム画面で直前に読んだ基本データがあれば再利用する（なければ読み込む）
        const reused = handoff.take(now)
        const basics =
          reused ?? (await perfAsync('study:loadStudyBasics', () => loadStudyBasics(repos, now)))
        if (!basics) {
          if (!cancelled) setState({ status: 'no-material' })
          return
        }
        const { context, session } = await perfAsync(
          'study:startStudySession',
          () => startStudySessionFrom(repos, basics, now),
          () => ({ reusedHomeData: reused !== null }),
        )
        if (!cancelled) {
          pendingIdRef.current = null
          setState({ status: 'ready', context, committed: session, pending: null, ...advance(session, now, null) })
        }
      } catch (error) {
        if (!cancelled) setState(toFailure(error, '学習データを読み込めませんでした。再読み込みしてください。'))
      }
    })()
    return () => {
      cancelled = true
    }
  }, [repos, clock, handoff, toFailure, loadCount])

  const computePreview = useCallback(
    (item: CurrentItem, context: StudyContext): Preview => {
      const now = clock()
      const snapshot = item.state ? toSchedulingSnapshot(item.state) : null
      const done = perfStart('study:preview-compute')
      const outcomes = context.scheduler.preview(snapshot, now)
      done()
      return { computedAt: now, outcomes }
    },
    [clock],
  )

  /** 答えを見る（データを変えないので、前の回答の保存中でもできる） */
  const reveal = useCallback(() => {
    if (state.status !== 'ready' || !state.item || state.revealed) return
    perfBegin('reveal')
    setState({ ...state, revealed: true, preview: computePreview(state.item, state.context) })
  }, [state, computePreview])

  /** 答えを表示したまま時間が経っていたら、次回予定を今の時刻で計算し直す */
  const refreshPreviewIfStale = useCallback(() => {
    if (state.status !== 'ready' || !state.item || !state.preview) return
    if (clock().getTime() - state.preview.computedAt.getTime() < PREVIEW_STALE_MS) return
    setState({ ...state, preview: computePreview(state.item, state.context) })
  }, [state, clock, computePreview])

  /** 保存待ちのレビューを Firestore に保存する（1 つのトランザクション）。同時に保存するのは 1 件だけ */
  const persist = useCallback(
    async (record: ReviewRecord) => {
      const id = record.log.id
      try {
        await perfAsync('study:save', () => repos.reviews.recordReview(record))
        perfEnd('save-after-next', 'study:save-done-after-next-shown')
        pendingIdRef.current = null
        setState((current) => {
          if (current.status !== 'ready' || current.pending?.record.log.id !== id) return current
          // 保存できたので、保存済みのセッションに反映する
          const committed = applyAnswer(current.committed, record.state, record.log.rating)
          const saved: ReadyState = { ...current, committed, pending: null }
          // 出せるカードがなかった（保存待ちのカードの再出題を待っていた等）なら、選び直す
          return current.item ? saved : { ...saved, ...advance(committed, clock(), null) }
        })
      } catch (error) {
        if (isCorruptedReviewStateError(error)) {
          pendingIdRef.current = null
          setState(toFailure(error, ''))
          return
        }
        const conflict = isAppError(error) && error.kind === 'conflict'
        setState((current) => {
          if (current.status !== 'ready' || current.pending?.record.log.id !== id) return current
          return {
            ...current,
            pending: {
              record,
              status: conflict ? 'conflict' : 'failed',
              message: conflict
                ? CONFLICT_MESSAGE
                : errorMessage(error, '通信状態を確認して、もう一度保存してください。'),
            },
          }
        })
      }
    },
    [repos, clock, toFailure],
  )

  /** 評価する：次のカードをすぐ表示し、この回答の保存を裏で始める */
  const answer = useCallback(
    (rating: ReviewRating) => {
      if (state.status !== 'ready' || !state.item || !state.revealed || state.pending) return
      // 二重押し：同じ描画の間に 2 回呼ばれても、保存待ちは 1 件だけ
      if (pendingIdRef.current !== null) return
      perfBegin('rate')
      // 正式なレビュー日時 = ボタンを押した時刻
      const reviewedAt = clock()
      const record = buildReview(
        state.context,
        state.committed,
        {
          card: state.item.card,
          rating,
          reviewedAt,
          durationMs: Math.max(0, reviewedAt.getTime() - state.shownAt.getTime()),
        },
        state.reviewId,
      )
      pendingIdRef.current = record.log.id
      const pending: PendingReview = { record, status: 'saving', message: null }
      setState({
        ...state,
        pending,
        ...advance(workingSession({ committed: state.committed, pending }), clock(), record.log.cardId),
      })
      void persist(record)
    },
    [state, clock, persist],
  )

  /** 保存に失敗した前の回答を、同じ内容（同じ id・評価・日時・状態）で再送する */
  const retrySave = useCallback(() => {
    if (state.status !== 'ready' || state.pending?.status !== 'failed') return
    const { record } = state.pending
    setState({ ...state, pending: { record, status: 'saving', message: null } })
    void persist(record)
  }, [state, persist])

  /** 競合したとき：保存待ちの回答を捨てずに上書きもせず、Firestore から最新の状態を読み込み直す */
  const reloadLatest = useCallback(() => {
    if (state.status !== 'ready' || state.pending?.status !== 'conflict') return
    pendingIdRef.current = null
    setState({ status: 'loading' })
    setLoadCount((count) => count + 1)
  }, [state])

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
    setState({
      ...state,
      ...advance(workingSession(state), clock(), state.pending?.record.log.cardId ?? null),
    })
  }, [state, clock])

  // 計測：画面に反映された時点（計測が無効なら何もしない）
  // reviewId はカードを出すたびに新しくなる（同じカードの再出題も区別できる）
  const shownReviewId = state.status === 'ready' ? state.reviewId : null
  const revealed = state.status === 'ready' && state.revealed
  useEffect(() => {
    if (shownReviewId === null) return
    perfEnd('study-start', 'study:first-card-shown')
    perfEnd('rate', 'study:next-card-shown')
    perfBegin('save-after-next')
  }, [shownReviewId])
  useEffect(() => {
    if (revealed) perfEnd('reveal', 'study:preview-shown')
  }, [revealed])

  return { view: toView(state), reveal, answer, retrySave, reloadLatest, restore, refreshPreviewIfStale, checkAgain }
}

function toView(state: InternalState): StudyView {
  if (state.status !== 'ready') return state
  const materialTitle = state.context.material.title
  const pending = state.pending ? { status: state.pending.status, message: state.pending.message } : null
  if (!state.item) {
    const next = nextStudyItem(workingSession(state), state.checkedAt)
    return {
      status: 'done',
      materialTitle,
      answered: state.committed.answered,
      answeredTotal: answeredCount(state.committed),
      nextLearningDueAt: next.kind === 'done' ? next.nextLearningDueAt : null,
      checkedAt: state.checkedAt,
      pending,
    }
  }
  return {
    status: 'studying',
    materialTitle,
    item: state.item,
    counts: sessionCounts(state.committed, state.shownAt),
    revealed: state.revealed,
    preview: state.preview,
    pending,
    canRate: state.pending === null,
  }
}
