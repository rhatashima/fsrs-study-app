/*
 * 性能計測（調査用。既定では何もしない）。
 * - 開発サーバー（npm run dev）では有効
 * - 本番では、ブラウザのコンソールで localStorage.setItem('fsrs:perf', '1') を実行して再読み込みしたときだけ有効
 *   （無効化：localStorage.removeItem('fsrs:perf')）
 * 有効時はコンソールに [perf] の行を出し、window.__fsrsPerf.summary() で集計を表で表示できる。
 */

export interface PerfEvent {
  /** ページの読み込み開始（navigation start）からの経過ミリ秒 */
  at: number
  name: string
  /** 処理にかかった時間（ミリ秒）。区間の計測のとき */
  ms?: number
  detail?: Record<string, unknown>
}

function readFlag(): boolean {
  try {
    return globalThis.localStorage?.getItem('fsrs:perf') === '1'
  } catch {
    return false
  }
}

const enabled = (import.meta.env.DEV && import.meta.env.MODE !== 'test') || readFlag()
const events: PerfEvent[] = []

export function isPerfEnabled(): boolean {
  return enabled
}

function record(event: PerfEvent): void {
  events.push(event)
  const ms = event.ms === undefined ? '' : ` ${event.ms.toFixed(0)}ms`
  const detail = event.detail ? ` ${JSON.stringify(event.detail)}` : ''
  console.info(`[perf] ${event.at.toFixed(0)}ms ${event.name}${ms}${detail}`)
}

/** 時点を記録する（ページの読み込み開始からの経過時間） */
export function perfMark(name: string, detail?: Record<string, unknown>): void {
  if (!enabled) return
  record({ at: performance.now(), name, ...(detail ? { detail } : {}) })
}

/** 区間の計測を始める。戻り値の関数を呼ぶと、その区間の時間を記録する */
export function perfStart(name: string): (detail?: Record<string, unknown>) => void {
  if (!enabled) return () => undefined
  const start = performance.now()
  return (detail) => record({ at: performance.now(), name, ms: performance.now() - start, ...(detail ? { detail } : {}) })
}

/** 非同期処理の時間を計測する */
export async function perfAsync<T>(
  name: string,
  fn: () => Promise<T>,
  describe?: (result: T) => Record<string, unknown>,
): Promise<T> {
  if (!enabled) return fn()
  const done = perfStart(name)
  try {
    const result = await fn()
    done(describe?.(result))
    return result
  } catch (error) {
    done({ failed: true })
    throw error
  }
}

/** ユーザー操作の開始時刻（「答えを見る」「評価」など）を覚え、画面に反映された時点で区間を記録する */
const pending = new Map<string, number>()

export function perfBegin(key: string): void {
  if (enabled) pending.set(key, performance.now())
}

export function perfEnd(key: string, name: string, detail?: Record<string, unknown>): void {
  if (!enabled) return
  const start = pending.get(key)
  if (start === undefined) return
  pending.delete(key)
  record({ at: performance.now(), name, ms: performance.now() - start, ...(detail ? { detail } : {}) })
}

if (enabled && typeof window !== 'undefined') {
  ;(window as unknown as { __fsrsPerf: unknown }).__fsrsPerf = {
    events,
    /** Firestore の操作を種類ごとに集計して表で表示する */
    summary() {
      const rows = new Map<string, { calls: number; totalMs: number; maxMs: number; docs: number }>()
      for (const e of events.filter((x) => x.name.startsWith('firestore:'))) {
        const row = rows.get(e.name) ?? { calls: 0, totalMs: 0, maxMs: 0, docs: 0 }
        row.calls += 1
        row.totalMs += e.ms ?? 0
        row.maxMs = Math.max(row.maxMs, e.ms ?? 0)
        row.docs += Number(e.detail?.docs ?? 0)
        rows.set(e.name, row)
      }
      console.table(
        Object.fromEntries(
          [...rows].map(([name, r]) => [name, { ...r, avgMs: Math.round(r.totalMs / r.calls), totalMs: Math.round(r.totalMs), maxMs: Math.round(r.maxMs) }]),
        ),
      )
      console.table(events.filter((x) => !x.name.startsWith('firestore:')).map((e) => ({ at: Math.round(e.at), name: e.name, ms: e.ms === undefined ? '' : Math.round(e.ms) })))
    },
  }
}
