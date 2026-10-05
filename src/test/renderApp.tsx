import { render } from '@testing-library/react'
import { createMemoryRouter } from 'react-router'
import { RouterProvider } from 'react-router/dom'
import { AuthProvider } from '../app/AuthProvider'
import { ClockContext } from '../app/clockContext'
import { RepositoryFactoryContext, type RepositoryFactory } from '../app/repositoryContext'
import { routes } from '../app/routes'
import type { Repositories } from '../repositories/types'
import type { SignInEnvironment } from '../services/auth/signInMethod'
import { createFakeAuthGateway, OWNER, type FakeAuth } from './fakeAuth'

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

export const DESKTOP_ENV: SignInEnvironment = {
  hostname: 'example.firebaseapp.com',
  isStandalone: false,
  isTouchPrimary: false,
}

/**
 * アプリ全体を、指定したリポジトリ・時計・URL・認証状態で表示する。
 * 既定では Owner としてログイン済み。repos を渡すと、ログインした利用者はそのデータを使う。
 */
export function renderApp(params: {
  repos?: Repositories
  createRepositories?: RepositoryFactory
  clock?: () => Date
  path: string
  auth?: FakeAuth
  ownerUid?: string | null
  environment?: SignInEnvironment
}) {
  const auth = params.auth ?? createFakeAuthGateway()
  const router = createMemoryRouter(routes, { initialEntries: [params.path] })
  const factory: RepositoryFactory =
    params.createRepositories ??
    (() => {
      if (!params.repos) throw new Error('renderApp: repos か createRepositories を指定してください')
      return params.repos
    })
  const result = render(
    <ClockContext value={params.clock ?? (() => new Date())}>
      <AuthProvider
        gateway={auth.gateway}
        ownerUid={params.ownerUid === undefined ? OWNER.uid : params.ownerUid}
        detectEnvironment={() => params.environment ?? DESKTOP_ENV}
      >
        <RepositoryFactoryContext value={factory}>
          <RouterProvider router={router} />
        </RepositoryFactoryContext>
      </AuthProvider>
    </ClockContext>,
  )
  return { ...result, router, auth }
}
