// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { SAMPLE_CARDS, SAMPLE_CASTLE_MATERIAL_ID, SAMPLE_MATERIALS } from '../dev/sampleData'
import { nextStudyItem, type Card } from '../domain'
import { createMemoryRepositories } from '../repositories/memory/createMemoryRepositories'
import type { Repositories } from '../repositories/types'
import { STUDY_BASICS_MAX_AGE_MS, StudyBasicsHandoff } from './studyBasicsHandoff'
import { buildReview, loadStudyBasics, saveReview, startStudySessionFrom } from './studyService'

/*
 * 読み込みの往復回数の確認。リポジトリの各呼び出しに一定の遅延を入れ、
 * 何回呼んだか・何段に分かれて順番待ちしたか（＝通信の往復の段数）を数える。
 */

const DELAY_MS = 25
const NOW = new Date(2026, 9, 6, 10, 0)

interface Call {
  name: string
  start: number
}

function withLatency(repos: Repositories, calls: Call[]): Repositories {
  const wrap = <T extends object>(group: string, target: T): T =>
    new Proxy(target, {
      get(obj, prop) {
        const value: unknown = Reflect.get(obj, prop)
        if (typeof value !== 'function') return value
        return async (...args: unknown[]) => {
          calls.push({ name: `${group}.${String(prop)}`, start: performance.now() })
          await new Promise((resolve) => setTimeout(resolve, DELAY_MS))
          return (value as (...a: unknown[]) => Promise<unknown>).apply(obj, args)
        }
      },
    })
  return {
    materials: wrap('materials', repos.materials),
    cards: wrap('cards', repos.cards),
    reviews: wrap('reviews', repos.reviews),
    settings: wrap('settings', repos.settings),
  }
}

/** 呼び出しを開始時刻で段に分ける（同じ段の呼び出しは並列に実行されたもの） */
function stages(calls: Call[]): string[][] {
  const t0 = Math.min(...calls.map((c) => c.start))
  const result: string[][] = []
  for (const call of calls) {
    const index = Math.round((call.start - t0) / DELAY_MS)
    ;(result[index] ??= []).push(call.name)
  }
  return result.filter(Boolean).map((names) => names.sort())
}

async function setup() {
  const base = createMemoryRepositories({ materials: SAMPLE_MATERIALS, cards: SAMPLE_CARDS }, { clock: () => NOW })
  // FSRS 設定の記録は初回だけ書き込まれるので、計測の前に 1 回学習を始めておく
  const basics = await loadStudyBasics(base, NOW)
  await startStudySessionFrom(base, basics!, NOW)
  const calls: Call[] = []
  return { base, calls, repos: withLatency(base, calls) }
}

describe('学習データの読み込み（往復の段数と回数）', () => {
  it('ホーム画面：2 段・4 回（設定 ∥ 教材一覧 → 集計 ∥ 期限カード）', async () => {
    const { repos, calls } = await setup()
    await loadStudyBasics(repos, NOW)
    expect(stages(calls)).toEqual([
      ['materials.list', 'settings.getSettings'],
      ['reviews.getProgress', 'reviews.listDue'],
    ])
  })

  it('学習開始（ホームのデータなし）：4 段・7 回', async () => {
    const { repos, calls } = await setup()
    const basics = await loadStudyBasics(repos, NOW)
    await startStudySessionFrom(repos, basics!, NOW)
    expect(stages(calls)).toEqual([
      ['materials.list', 'settings.getSettings'],
      ['reviews.getProgress', 'reviews.listDue'],
      ['cards.getByIds', 'cards.listNewCandidates'],
      ['reviews.findCardsWithLogs', 'reviews.getStates'],
    ])
  })

  it('学習開始（ホームのデータを再利用）：2 段・4 回', async () => {
    const { base, repos, calls } = await setup()
    const basics = await loadStudyBasics(base, NOW)
    await startStudySessionFrom(repos, basics!, NOW)
    expect(stages(calls)).toEqual([
      ['cards.getByIds', 'cards.listNewCandidates'],
      ['reviews.findCardsWithLogs', 'reviews.getStates'],
    ])
  })

  it('次のカードは端末内で選ぶ（1 レビューの保存は 1 回の呼び出しだけ）', async () => {
    const { base, repos, calls } = await setup()
    const basics = await loadStudyBasics(base, NOW)
    const { context, session } = await startStudySessionFrom(base, basics!, NOW)
    const item = nextStudyItem(session, NOW)
    if (item.kind === 'done') throw new Error('unreachable')
    const record = buildReview(context, session, { card: item.card, rating: 'good', reviewedAt: NOW, durationMs: 1 }, 'l1')
    const next = await saveReview(repos, session, record)
    expect(calls.map((c) => c.name)).toEqual(['reviews.recordReview'])
    expect(nextStudyItem(next, NOW).kind).toBe('new')
  })

  it('並列にしても結果は同じ（期限カード・新規カード・上限）', async () => {
    const { base } = await setup()
    const basics = await loadStudyBasics(base, NOW)
    const { session } = await startStudySessionFrom(base, basics!, NOW)
    const castle = SAMPLE_CARDS.filter((c) => c.materialId === SAMPLE_CASTLE_MATERIAL_ID && !c.isArchived)
    expect(session.newCardIds).toEqual(castle.slice(0, 10).map((c: Card) => c.id))
  })
})

describe('StudyBasicsHandoff（ホーム → 学習開始の受け渡し）', () => {
  async function basicsAt(now: Date) {
    const repos = createMemoryRepositories({ materials: SAMPLE_MATERIALS, cards: SAMPLE_CARDS }, { clock: () => now })
    return (await loadStudyBasics(repos, now))!
  }

  it('1 回だけ取り出せる', async () => {
    const handoff = new StudyBasicsHandoff()
    const basics = await basicsAt(NOW)
    handoff.put(basics)
    expect(handoff.take(NOW)).toBe(basics)
    expect(handoff.take(NOW)).toBeNull()
  })

  it(`${STUDY_BASICS_MAX_AGE_MS / 1000} 秒を過ぎたものは使わない`, async () => {
    const handoff = new StudyBasicsHandoff()
    handoff.put(await basicsAt(NOW))
    expect(handoff.take(new Date(NOW.getTime() + STUDY_BASICS_MAX_AGE_MS + 1))).toBeNull()
    handoff.put(await basicsAt(NOW))
    expect(handoff.take(new Date(NOW.getTime() + STUDY_BASICS_MAX_AGE_MS))).not.toBeNull()
  })

  it('学習日が変わったもの・読み込みより前の時刻では使わない', async () => {
    const handoff = new StudyBasicsHandoff()
    const lateNight = new Date(2026, 9, 7, 3, 59, 30) // 4:00 の 30 秒前に読み込み
    handoff.put(await basicsAt(lateNight))
    expect(handoff.take(new Date(2026, 9, 7, 4, 0, 10))).toBeNull()
    handoff.put(await basicsAt(NOW))
    expect(handoff.take(new Date(NOW.getTime() - 1000))).toBeNull()
  })
})
