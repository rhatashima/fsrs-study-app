import { render } from '@testing-library/react'
import { createMemoryRouter } from 'react-router'
import { RouterProvider } from 'react-router/dom'
import { ClockContext } from '../app/clockContext'
import { RepositoryContext } from '../app/repositoryContext'
import { routes } from '../app/routes'
import type { Repositories } from '../repositories/types'

/** 時刻を進められるテスト用の時計 */
export function createTestClock(start: Date) {
  let current = start.getTime()
  return {
    now: () => new Date(current),
    set: (date: Date) => {
      current = date.getTime()
    },
    advanceMinutes: (minutes: number) => {
      current += minutes * 60_000
    },
  }
}

/** アプリ全体を、指定したリポジトリ・時計・URL で表示する */
export function renderApp(params: { repos: Repositories; clock: () => Date; path: string }) {
  const router = createMemoryRouter(routes, { initialEntries: [params.path] })
  const result = render(
    <ClockContext value={params.clock}>
      <RepositoryContext value={params.repos}>
        <RouterProvider router={router} />
      </RepositoryContext>
    </ClockContext>,
  )
  return { ...result, router }
}
