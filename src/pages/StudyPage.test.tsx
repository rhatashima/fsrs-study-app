import { cleanup, fireEvent, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { AppError, CorruptedReviewStateError, type Card } from '../domain'
import type { ReviewRecord } from '../repositories/types'
import { createMemoryRepositories } from '../repositories/memory/createMemoryRepositories'
import { startStudySession, submitReview } from '../services/studyService'
import { makeCard, makeMaterial } from '../test/factories'
import { createTestClock, renderApp } from '../test/renderApp'

const START = new Date(2026, 9, 6, 10, 0) // ローカル時刻 2026-10-06 10:00

function setup() {
  const repos = createMemoryRepositories({
    materials: [makeMaterial({ id: 'm1', title: 'テスト教材', newCardsPerDay: 2 })],
    cards: [
      makeCard({ id: 'c1', order: 1, question: '天守の最上階は？', answer: '最上重', explanation: '解説 1' }),
      makeCard({
        id: 'c2',
        order: 2,
        question: 'この画像は？',
        answer: '模式図',
        imageUrl: '/images/samples/castle-keep.svg',
      }),
      makeCard({ id: 'c3', order: 3, question: '3 枚目（今日の新規上限の外）', answer: '-' }),
    ],
  })
  const clock = createTestClock(START)
  const user = userEvent.setup()
  renderApp({ repos, clock: clock.now, path: '/study' })
  return { repos, clock, user }
}

const ratingButton = (name: RegExp) =>
  within(screen.getByRole('group', { name: '自己評価' })).getByRole('button', { name })

describe('学習画面', () => {
  it('問題 → 答えを見る → Good → 保存 → 次のカード', async () => {
    const { repos, clock, user } = setup()

    // 問題だけが表示され、答えは隠れている
    expect(await screen.findByText('天守の最上階は？')).toBeInTheDocument()
    expect(screen.queryByText('最上重')).not.toBeInTheDocument()
    expect(screen.getByText('新規')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: '答えを見る' }))
    expect(screen.getByText('最上重')).toBeInTheDocument()
    expect(screen.getByText('解説 1')).toBeInTheDocument()

    // 4 評価それぞれの次回予定（ts-fsrs の計算結果から生成）
    expect(ratingButton(/^忘れた/)).toHaveTextContent('1分')
    expect(ratingButton(/^難しい/)).toHaveTextContent('6分')
    expect(ratingButton(/^正解/)).toHaveTextContent('10分')
    expect(ratingButton(/^簡単/)).toHaveTextContent(/\d+日/)

    clock.advanceMinutes(1) // ボタンを押すまでに 1 分経過
    await user.click(ratingButton(/^正解/))

    // 次のカード（画像付き）
    expect(await screen.findByText('この画像は？')).toBeInTheDocument()
    expect(screen.getByRole('img', { name: '問題の画像' })).toHaveAttribute('src', '/images/samples/castle-keep.svg')

    // 保存されている：正式なレビュー日時はボタンを押した時刻
    const [state] = await repos.reviews.getStates('m1', ['c1'])
    expect(state).toMatchObject({ phase: 'learning', reps: 1 })
    expect(state?.due).toEqual(new Date(2026, 9, 6, 10, 11))
    const logs = await repos.reviews.listLogsForCard('m1', 'c1', { limit: 5 })
    expect(logs).toHaveLength(1)
    expect(logs[0]).toMatchObject({ rating: 'good', reviewedAt: new Date(2026, 9, 6, 10, 1), durationMs: 60_000 })
    expect((await repos.reviews.getProgress('m1')).studiedCards).toBe(1)
  })

  it('答えを見ただけでは何も保存されない', async () => {
    const { repos, user } = setup()
    await user.click(await screen.findByRole('button', { name: '答えを見る' }))
    expect(await repos.reviews.getStates('m1', ['c1'])).toEqual([])
    expect(await repos.reviews.listLogsForCard('m1', 'c1', { limit: 5 })).toEqual([])
  })

  it('出せるカードがなくなると完了画面。学習中カードは due 時刻になると再出題される', async () => {
    const { clock, user } = setup()

    await user.click(await screen.findByRole('button', { name: '答えを見る' }))
    await user.click(ratingButton(/^正解/)) // c1 → 10 分後に再出題
    await user.click(await screen.findByRole('button', { name: '答えを見る' }))
    await user.click(ratingButton(/^簡単/)) // c2 → 数日後

    expect(await screen.findByText('今出せるカードは終わりました')).toBeInTheDocument()
    expect(screen.getByText('今回の回答 2問')).toBeInTheDocument()
    expect(screen.getByText(/正解（Good） 1/)).toBeInTheDocument()
    expect(screen.getByText(/簡単（Easy） 1/)).toBeInTheDocument()
    expect(screen.getByText('次の復習まであと 10分')).toBeInTheDocument()
    // 3 枚目は今日の新規上限（2 枚）の外なので出ない
    expect(screen.queryByText('3 枚目（今日の新規上限の外）')).not.toBeInTheDocument()

    // まだ時刻前：確認しても出ない
    clock.advanceMinutes(5)
    await user.click(screen.getByRole('button', { name: 'もう一度確認する' }))
    expect(screen.getByText('次の復習まであと 5分')).toBeInTheDocument()

    // due 時刻を過ぎると学習中カードとして再出題
    clock.advanceMinutes(5)
    await user.click(screen.getByRole('button', { name: 'もう一度確認する' }))
    expect(await screen.findByText('天守の最上階は？')).toBeInTheDocument()
    expect(screen.getByText('学習中')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: '答えを見る' }))
    await user.click(ratingButton(/^正解/))
    expect(await screen.findByText('今日の学習は完了しました')).toBeInTheDocument()
    expect(screen.getByText('今回の回答 3問')).toBeInTheDocument()
  })

  it('答えを表示したまま時間が経ったら、画面に戻ったときに次回予定を計算し直す', async () => {
    // c1 を Easy で復習（Review）状態にしておく
    const repos = createMemoryRepositories({
      materials: [makeMaterial({ id: 'm1', newCardsPerDay: 1 })],
      cards: [makeCard({ id: 'c1', order: 1, question: '復習する問題' })],
    })
    const { context, session } = await startStudySession(repos, 'm1', START)
    const { record } = await submitReview(repos, context, session, {
      card: session.cards['c1'] as Card,
      rating: 'easy',
      reviewedAt: START,
      durationMs: null,
    })
    const clock = createTestClock(record.state.due)
    const user = userEvent.setup()
    renderApp({ repos, clock: clock.now, path: '/study' })

    await user.click(await screen.findByRole('button', { name: '答えを見る' }))
    const before = ratingButton(/^正解/).textContent

    // 答えを表示したまま 60 日経ってから画面に戻る → 経過日数が変わるので計算結果も変わる
    clock.advanceMinutes(60 * 24 * 60)
    fireEvent(document, new Event('visibilitychange'))
    expect(ratingButton(/^正解/).textContent).not.toBe(before)
  })

  it('画像を読み込めない場合は代替表示にして学習を続けられる', async () => {
    const { user } = setup()
    await user.click(await screen.findByRole('button', { name: '答えを見る' }))
    await user.click(ratingButton(/^正解/))
    const image = await screen.findByRole('img', { name: '問題の画像' })
    fireEvent.error(image)
    expect(screen.getByText('画像を読み込めませんでした')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '答えを見る' })).toBeEnabled()
  })

  it('学習状態が壊れている・見つからない場合は、学習を止めて履歴からの復元を選べる', async () => {
    const { repos, user } = setup()
    // c1 を学習済みにしてから、ReviewState だけが見つからない状態にする
    const { context, session } = await startStudySession(repos, 'm1', START)
    await submitReview(repos, context, session, {
      card: session.cards['c1'] as Card,
      rating: 'easy',
      reviewedAt: START,
      durationMs: null,
    })
    // 保存されている c1 の学習状態が壊れている（Firestore で形式が正しくない場合と同じエラー）
    const listDue = repos.reviews.listDue.bind(repos.reviews)
    let corrupted = true
    repos.reviews.listDue = (materialId, options) =>
      corrupted ? Promise.reject(new CorruptedReviewStateError('m1', ['c1'])) : listDue(materialId, options)
    const restoreState = repos.reviews.restoreState.bind(repos.reviews)
    const restoredIds: string[] = []
    repos.reviews.restoreState = async (state) => {
      await restoreState(state)
      restoredIds.push(state.cardId)
      corrupted = false
    }

    // 新しい画面で学習を開く（この画面は最初の setup の画面とは別）
    cleanup()
    renderApp({ repos, clock: createTestClock(new Date(2026, 9, 6, 11, 0)).now, path: '/study' })
    expect(await screen.findByRole('alert')).toHaveTextContent('学習履歴から復元できます')
    expect(screen.queryByRole('button', { name: '答えを見る' })).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: '学習履歴から復元する' }))
    // 復元後は通常どおり学習できる（c1 は復習待ちなので、次の新規 c2 が出る）
    expect(await screen.findByText('この画像は？')).toBeInTheDocument()
    expect(restoredIds).toEqual(['c1'])
    const [restored] = await repos.reviews.getStates('m1', ['c1'])
    expect(restored?.phase).toBe('review')
    expect(await repos.reviews.listLogsForCard('m1', 'c1', { limit: 5 })).toHaveLength(1)
  })
})

/**
 * 保存（recordReview）を手動で完了・失敗させられるようにする。
 * 呼ばれた内容を sent に記録し、release / fail / passThrough で結果を決める。
 */
function controlSaves(repos: ReturnType<typeof createMemoryRepositories>) {
  const original = repos.reviews.recordReview.bind(repos.reviews)
  const sent: ReviewRecord[] = []
  const waiting: { resolve: () => void; reject: (e: unknown) => void; record: ReviewRecord }[] = []
  let passThrough = false
  repos.reviews.recordReview = (record) => {
    sent.push(structuredClone(record))
    if (passThrough) return original(record)
    return new Promise<void>((resolve, reject) => waiting.push({ resolve, reject, record }))
  }
  return {
    sent,
    /** 保存待ちを完了させる（実際にメモリ上のリポジトリへ保存する） */
    async release() {
      const next = waiting.shift()
      if (!next) throw new Error('保存待ちがない')
      await original(next.record)
      next.resolve()
    },
    /** 保存待ちを失敗させる（何も保存しない） */
    fail(error: unknown) {
      const next = waiting.shift()
      if (!next) throw new Error('保存待ちがない')
      next.reject(error)
    },
    /** 実際には保存したが、応答が失われたことにする */
    async saveButLoseResponse(error: unknown) {
      const next = waiting.shift()
      if (!next) throw new Error('保存待ちがない')
      await original(next.record)
      next.reject(error)
    },
    passThroughFromNowOn() {
      passThrough = true
    },
    get waitingCount() {
      return waiting.length
    },
  }
}

async function rateFirstCardGood(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByRole('button', { name: '答えを見る' }))
  await user.click(ratingButton(/^正解/))
}

describe('評価後すぐ次の問題を表示し、保存は裏で行う（保存待ちは最大 1 件）', () => {
  it('評価の直後に、保存の完了を待たずに次の問題を表示する', async () => {
    const { repos, user } = setup()
    const saves = controlSaves(repos)
    await rateFirstCardGood(user)

    expect(await screen.findByText('この画像は？')).toBeInTheDocument()
    expect(saves.waitingCount).toBe(1)
    expect(screen.getByRole('status')).toHaveTextContent('前の回答を保存中…')
  })

  it('前の回答の保存中も「答えを見る」はできるが、評価はできない。保存が終わると評価できる', async () => {
    const { repos, user } = setup()
    const saves = controlSaves(repos)
    await rateFirstCardGood(user)

    await user.click(await screen.findByRole('button', { name: '答えを見る' }))
    expect(screen.getByText('模式図')).toBeInTheDocument()
    for (const name of [/^忘れた/, /^難しい/, /^正解/, /^簡単/]) expect(ratingButton(name)).toBeDisabled()
    await user.click(ratingButton(/^正解/))
    expect(saves.sent).toHaveLength(1)

    await saves.release()
    expect(await screen.findByRole('button', { name: /^正解/ })).toBeEnabled()
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })

  it('保存待ちは常に 1 件：保存中に評価しても 2 件目の保存は始まらない', async () => {
    const { repos, user } = setup()
    const saves = controlSaves(repos)
    await rateFirstCardGood(user)
    await user.click(await screen.findByRole('button', { name: '答えを見る' }))
    fireEvent.click(ratingButton(/^簡単/))
    fireEvent.click(ratingButton(/^正解/))
    expect(saves.sent).toHaveLength(1)
    expect(saves.waitingCount).toBe(1)
  })

  it('評価ボタンを素早く 2 回押しても、保存は 1 回だけ', async () => {
    const { repos, user } = setup()
    const saves = controlSaves(repos)
    saves.passThroughFromNowOn()
    await user.click(await screen.findByRole('button', { name: '答えを見る' }))
    const good = ratingButton(/^正解/)
    fireEvent.click(good)
    fireEvent.click(good)
    expect(await screen.findByText('この画像は？')).toBeInTheDocument()
    expect(saves.sent).toHaveLength(1)
    expect(await repos.reviews.listLogsForCard('m1', 'c1', { limit: 5 })).toHaveLength(1)
  })

  it('保存が終わるまでは、学習状態・学習履歴・集計のどれも保存されておらず、終わると 3 つとも保存される', async () => {
    const { repos, user } = setup()
    const saves = controlSaves(repos)
    await rateFirstCardGood(user)
    await screen.findByText('この画像は？')

    expect(await repos.reviews.getStates('m1', ['c1'])).toEqual([])
    expect(await repos.reviews.listLogsForCard('m1', 'c1', { limit: 5 })).toEqual([])
    expect((await repos.reviews.getProgress('m1')).studiedCards).toBe(0)

    await saves.release()
    await screen.findByText('この画像は？')
    expect(await repos.reviews.getStates('m1', ['c1'])).toHaveLength(1)
    expect(await repos.reviews.listLogsForCard('m1', 'c1', { limit: 5 })).toHaveLength(1)
    expect((await repos.reviews.getProgress('m1')).studiedCards).toBe(1)
  })

  it('保存が終わっていない回答は、今回の回答数・件数に数えない（保存が終わると数える）', async () => {
    const { repos, user } = setup()
    const saves = controlSaves(repos)
    await rateFirstCardGood(user)
    // 保存待ちのまま次のカード（c2）を表示中：新規の件数は保存済みのものだけで数える
    expect(await screen.findByText('この画像は？')).toBeInTheDocument()
    expect(screen.getByText(/新規 2/)).toBeInTheDocument()
    await saves.release()
    await user.click(await screen.findByRole('button', { name: '答えを見る' }))
    expect(await screen.findByText(/新規 1/)).toBeInTheDocument()

    // 2 枚目を評価（最後のカード）→ 完了画面。保存が終わるまでは今回の回答は 1 問
    await user.click(ratingButton(/^簡単/))
    expect(await screen.findByRole('heading', { name: '前の回答の保存を待っています' })).toBeInTheDocument()
    expect(screen.getByText('今回の回答 1問')).toBeInTheDocument()
    await saves.release()
    expect(await screen.findByText('今回の回答 2問')).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: '前の回答の保存を待っています' })).not.toBeInTheDocument()
  })

  it('保存に失敗しても回答は捨てず、同じ内容（id・日時・評価・状態）で再送できる。再送が成功すると元に戻る', async () => {
    const { repos, clock, user } = setup()
    const saves = controlSaves(repos)
    await rateFirstCardGood(user)
    saves.fail(new AppError('network', 'サーバーに接続できませんでした。'))

    expect(await screen.findByRole('alert')).toHaveTextContent('前の回答を保存できませんでした')
    expect(screen.getByText('この画像は？')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '答えを見る' }))
    expect(ratingButton(/^正解/)).toBeDisabled()

    // 未保存のままページを閉じようとすると確認が出る
    const leaving = new Event('beforeunload', { cancelable: true })
    window.dispatchEvent(leaving)
    expect(leaving.defaultPrevented).toBe(true)

    clock.advanceMinutes(3)
    await user.click(screen.getByRole('button', { name: 'もう一度保存する' }))
    expect(saves.sent).toHaveLength(2)
    expect(saves.sent[1]).toEqual(saves.sent[0])
    expect(saves.sent[1]?.log.reviewedAt).toEqual(START)
    await saves.release()

    expect(await screen.findByRole('button', { name: /^正解/ })).toBeEnabled()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    const logs = await repos.reviews.listLogsForCard('m1', 'c1', { limit: 5 })
    expect(logs).toHaveLength(1)
    expect(logs[0]?.id).toBe(saves.sent[0]?.log.id)
    // 保存できた後は確認を出さない（画面の更新を待つ）
    await expect
      .poll(() => {
        const afterSave = new Event('beforeunload', { cancelable: true })
        window.dispatchEvent(afterSave)
        return afterSave.defaultPrevented
      })
      .toBe(false)
  })

  it('サーバーには保存されたが応答が失われた場合も、再送で二重登録しない', async () => {
    const { repos, user } = setup()
    const saves = controlSaves(repos)
    await rateFirstCardGood(user)
    await saves.saveButLoseResponse(new AppError('network', 'サーバーに接続できませんでした。'))
    expect(await screen.findByRole('alert')).toHaveTextContent('前の回答を保存できませんでした')

    await user.click(screen.getByRole('button', { name: 'もう一度保存する' }))
    await saves.release()
    await waitForNoAlert()
    expect(await repos.reviews.listLogsForCard('m1', 'c1', { limit: 5 })).toHaveLength(1)
    const progress = await repos.reviews.getProgress('m1')
    expect(progress.ratingCounts.good).toBe(1)
    expect(progress.studiedCards).toBe(1)
  })

  it('別の端末で先に更新されていた（競合）場合は、再送せず上書きもせず、最新の状態を読み込み直せる', async () => {
    const { repos, user } = setup()
    const saves = controlSaves(repos)
    await rateFirstCardGood(user)
    saves.fail(new AppError('conflict', 'このカードは別の端末などで先に学習されています。'))

    expect(await screen.findByRole('alert')).toHaveTextContent('別の端末で学習状態が更新されています')
    expect(screen.queryByRole('button', { name: 'もう一度保存する' })).not.toBeInTheDocument()
    expect(await repos.reviews.listLogsForCard('m1', 'c1', { limit: 5 })).toEqual([])
    expect(saves.sent).toHaveLength(1)

    saves.passThroughFromNowOn()
    await user.click(screen.getByRole('button', { name: '最新の状態を読み込む' }))
    // 読み込み直すと、保存されていない c1 から学習をやり直せる
    expect(await screen.findByText('天守の最上階は？')).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(saves.sent).toHaveLength(1)
  })
})

async function waitForNoAlert() {
  await expect.poll(() => screen.queryByRole('alert')).toBeNull()
}

