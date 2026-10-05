import { screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { createSampleRepositories } from '../dev/sampleRepositories'
import { createMemoryRepositories } from '../repositories/memory/createMemoryRepositories'
import { makeCard, makeMaterial, makeReviewRecord } from '../test/factories'
import { createTestClock, renderApp } from '../test/renderApp'

const NOW = new Date(2026, 9, 6, 10, 0)

describe('ホーム画面', () => {
  it('選択中の教材と、今日の復習・学習中・新規の件数を表示する', async () => {
    const repos = createMemoryRepositories({
      materials: [makeMaterial({ id: 'm1', title: '日本城郭検定3級', newCardsPerDay: 10 })],
      cards: Array.from({ length: 6 }, (_, i) => makeCard({ id: `c${i + 1}`, order: i + 1 })),
    })
    // c1：今日の復習（今日の夜が期限）、c2：学習中で今出せる、c3：学習中でまだ
    await repos.reviews.recordReview(
      makeReviewRecord({ cardId: 'c1', logId: 'l1', next: { phase: 'review', due: new Date(2026, 9, 6, 22, 0) } }),
    )
    await repos.reviews.recordReview(
      makeReviewRecord({ cardId: 'c2', logId: 'l2', next: { phase: 'learning', due: new Date(2026, 9, 6, 9, 55) } }),
    )
    await repos.reviews.recordReview(
      makeReviewRecord({ cardId: 'c3', logId: 'l3', next: { phase: 'learning', due: new Date(2026, 9, 6, 10, 5) } }),
    )

    renderApp({ repos, clock: createTestClock(NOW).now, path: '/' })

    expect(await screen.findByText('日本城郭検定3級')).toBeInTheDocument()
    const count = (label: string) => within(screen.getByText(label).parentElement as HTMLElement).getByRole('definition')
    expect(count('今日の復習')).toHaveTextContent('1')
    expect(count('学習中')).toHaveTextContent('1')
    // 新規：1 日 10 枚のうち、未学習は 3 枚（c4〜c6）だけ
    expect(count('新規')).toHaveTextContent('3')
    expect(screen.getByRole('link', { name: '学習を始める' })).toHaveAttribute('href', '/study')
  })

  it('開発用ダミーデータでは最初の教材の新規カードが表示される', async () => {
    renderApp({ repos: createSampleRepositories(), clock: createTestClock(NOW).now, path: '/' })
    expect(await screen.findByText('日本城郭検定3級')).toBeInTheDocument()
    const newCount = within(screen.getByText('新規').parentElement as HTMLElement).getByRole('definition')
    expect(newCount).toHaveTextContent('10')
  })
})
