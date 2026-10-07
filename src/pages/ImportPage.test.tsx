import { fireEvent, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import castleCsv from '../../samples/import/castle-3-sample.csv?raw'
import { SAMPLE_CARDS, SAMPLE_CASTLE_MATERIAL_ID, SAMPLE_MATERIALS } from '../dev/sampleData'
import { createMemoryRepositories } from '../repositories/memory/createMemoryRepositories'
import type { Card } from '../domain'
import { createTestClock, renderApp } from '../test/renderApp'

const NOW = new Date(2026, 9, 8, 10, 0)
const PATH = `/materials/${SAMPLE_CASTLE_MATERIAL_ID}/import`

function setup() {
  const repos = createMemoryRepositories({ materials: SAMPLE_MATERIALS, cards: SAMPLE_CARDS }, { clock: () => NOW })
  const user = userEvent.setup()
  const view = renderApp({ repos, clock: createTestClock(NOW).now, path: PATH })
  return { repos, user, ...view }
}

async function choose(user: ReturnType<typeof userEvent.setup>, name: string, text: string) {
  const input = await screen.findByLabelText('CSV / JSON ファイルを選ぶ')
  await user.upload(input, new File([text], name, { type: name.endsWith('.json') ? 'application/json' : 'text/csv' }))
}

const countOf = (label: string) => {
  const row = screen.getByRole('rowheader', { name: label }).closest('tr') as HTMLElement
  return within(row).getByRole('cell').textContent
}

/** saveMany を手動で進められるようにする */
function holdSaves(repos: ReturnType<typeof createMemoryRepositories>) {
  const original = repos.cards.saveMany.bind(repos.cards)
  const waiting: { cards: readonly Card[]; resolve: () => void; reject: (e: unknown) => void }[] = []
  let calls = 0
  repos.cards.saveMany = (cards) => {
    calls += 1
    return new Promise<void>((resolve, reject) => waiting.push({ cards, resolve, reject }))
  }
  return {
    get calls() {
      return calls
    },
    async next() {
      const item = waiting.shift()
      if (!item) throw new Error('保存待ちがない')
      await original(item.cards)
      item.resolve()
    },
    fail(error: unknown) {
      waiting.shift()?.reject(error)
    },
  }
}

describe('問題のインポート画面', () => {
  it('教材の画面から「問題をインポート」へ進める', async () => {
    const repos = createMemoryRepositories({ materials: SAMPLE_MATERIALS, cards: SAMPLE_CARDS }, { clock: () => NOW })
    const user = userEvent.setup()
    const { router } = renderApp({ repos, clock: createTestClock(NOW).now, path: '/materials' })
    const castle = await screen.findByRole('article', { name: '日本城郭検定3級' })
    await user.click(within(castle).getByRole('link', { name: '問題をインポート' }))
    expect(await screen.findByRole('heading', { level: 1, name: '問題をインポート' })).toBeInTheDocument()
    expect(router.state.location.pathname).toBe(PATH)
    expect(screen.getByText('取り込み先：日本城郭検定3級')).toBeInTheDocument()
  })

  it('ファイルを選ぶとプレビュー（新規・更新・変更なし・エラー・合計）を出し、まだ何も保存しない', async () => {
    const { repos, user } = setup()
    await choose(user, 'castle-3-sample.csv', castleCsv)

    expect(await screen.findByRole('heading', { name: 'インポート内容' })).toBeInTheDocument()
    expect(countOf('新規')).toBe('12')
    expect(countOf('更新')).toBe('1')
    expect(countOf('変更なし')).toBe('1')
    expect(countOf('エラー')).toBe('0')
    expect(countOf('合計')).toBe('14')
    expect(screen.getByText(/castle-001（解説）/)).toBeInTheDocument()
    expect(await repos.cards.getByIds(SAMPLE_CASTLE_MATERIAL_ID, ['castle-101'])).toEqual([])
  })

  it('検証エラーがあると、何行目の何が問題かを日本語で表示し、実行できない', async () => {
    const { user } = setup()
    await choose(user, 'bad.csv', 'id,question,answer,examDifficulty\nx1,Q,A,9\nx1,Q,,2\n')
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('取り込めません（3 件の問題）')
    expect(alert).toHaveTextContent('2 行目：問題の難易度（examDifficulty）は 1〜5 の整数で指定してください')
    expect(alert).toHaveTextContent('3 行目：答え（answer）が空です。')
    expect(screen.queryByRole('button', { name: 'インポートを実行' })).not.toBeInTheDocument()
  })

  it('実行すると「n / 合計 件」で進捗を出し、終わると結果を表示する。実行中に二重には始めない', async () => {
    const { repos, user } = setup()
    const saves = holdSaves(repos)
    await choose(user, 'castle-3-sample.csv', castleCsv)
    const run = await screen.findByRole('button', { name: 'インポートを実行' })
    fireEvent.click(run)
    fireEvent.click(run)

    expect(await screen.findByText(/0 \/ 13 件/)).toBeInTheDocument()
    expect(saves.calls).toBe(1)
    const leaving = new Event('beforeunload', { cancelable: true })
    window.dispatchEvent(leaving)
    expect(leaving.defaultPrevented).toBe(true)

    await saves.next()
    expect(await screen.findByRole('heading', { name: 'インポート完了' })).toBeInTheDocument()
    expect(countOf('新規')).toBe('12')
    expect(countOf('更新')).toBe('1')
    expect(countOf('変更なし')).toBe('1')
    expect(countOf('失敗')).toBe('0')
    expect(countOf('合計')).toBe('14')
    expect(screen.getByText('集計も作り直しました。')).toBeInTheDocument()
    expect((await repos.reviews.getProgress(SAMPLE_CASTLE_MATERIAL_ID)).totalCards).toBe(15 + 12)
  })

  it('途中で止まったら、同じファイルをもう一度取り込めば続行できると知らせる', async () => {
    const { repos, user } = setup()
    const saves = holdSaves(repos)
    await choose(user, 'castle-3-sample.csv', castleCsv)
    await user.click(await screen.findByRole('button', { name: 'インポートを実行' }))
    saves.fail(new Error('network'))
    expect(await screen.findByRole('heading', { name: 'インポートが途中で止まりました' })).toBeInTheDocument()
    expect(screen.getByRole('alert')).toHaveTextContent('同じファイルをもう一度取り込むことで続行できます')
    expect(countOf('失敗')).toBe('13')
  })

  it('集計の作り直しだけ失敗したら知らせ、「集計を作り直す」でやり直せる', async () => {
    const { repos, user } = setup()
    const replace = repos.reviews.replaceProgress.bind(repos.reviews)
    let failRebuild = true
    repos.reviews.replaceProgress = (progress) => (failRebuild ? Promise.reject(new Error('network')) : replace(progress))
    await choose(user, 'castle-3-sample.csv', castleCsv)
    await user.click(await screen.findByRole('button', { name: 'インポートを実行' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('カードの取り込みは完了しましたが、集計の再作成に失敗しました')
    failRebuild = false
    await user.click(screen.getByRole('button', { name: '集計を作り直す' }))
    expect(await screen.findByText('集計も作り直しました。')).toBeInTheDocument()
    expect((await repos.reviews.getProgress(SAMPLE_CASTLE_MATERIAL_ID)).totalCards).toBe(27)
  })

  it('取り込む内容がない（すべて変更なし）なら実行できない', async () => {
    const { user } = setup()
    await choose(user, 'same.json', JSON.stringify([{ id: 'castle-013', question: '安土城を築いた武将は誰？', answer: '織田信長' }]))
    expect(await screen.findByRole('button', { name: '取り込む内容はありません' })).toBeDisabled()
  })
})
