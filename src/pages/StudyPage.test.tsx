import { fireEvent, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import type { Card } from '../domain'
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

  it('保存に失敗したらエラーを表示し、同じカードのまま再度押せる', async () => {
    const { repos, user } = setup()
    const original = repos.reviews.recordReview.bind(repos.reviews)
    let fail = true
    repos.reviews.recordReview = (record) =>
      fail ? Promise.reject(new Error('network')) : original(record)

    await user.click(await screen.findByRole('button', { name: '答えを見る' }))
    await user.click(ratingButton(/^正解/))
    expect(await screen.findByRole('alert')).toHaveTextContent('保存できませんでした')
    expect(screen.getByText('天守の最上階は？')).toBeInTheDocument()

    fail = false
    await user.click(ratingButton(/^正解/))
    expect(await screen.findByText('この画像は？')).toBeInTheDocument()
    expect(await repos.reviews.listLogsForCard('m1', 'c1', { limit: 5 })).toHaveLength(1)
  })
})
