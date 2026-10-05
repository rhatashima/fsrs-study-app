import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { createSampleRepositories } from '../dev/sampleRepositories'
import { AppError } from '../domain'
import { ConfigErrorPage } from '../pages/ConfigErrorPage'
import { createFakeAuthGateway, OWNER, STRANGER } from '../test/fakeAuth'
import { createTestClock, renderApp } from '../test/renderApp'

const NOW = new Date(2026, 9, 6, 10, 0)

function setup(options: Parameters<typeof createFakeAuthGateway>[0] & { path?: string; ownerUid?: string | null } = {}) {
  const auth = createFakeAuthGateway(options)
  const createRepositories = vi.fn(createSampleRepositories)
  const user = userEvent.setup()
  const view = renderApp({
    auth,
    createRepositories,
    clock: createTestClock(NOW).now,
    path: options.path ?? '/',
    ownerUid: options.ownerUid,
  })
  return { ...view, auth, createRepositories, user }
}

const appNav = () => screen.queryByRole('navigation', { name: 'メインメニュー' })

describe('認証による画面の切り替え', () => {
  it('確認中はログイン画面もアプリ画面も出さず、確認後にアプリを表示する（ちらつかない）', async () => {
    const { auth } = setup({ initialUser: 'pending' })
    expect(screen.getByText('確認中…')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Googleでログイン' })).not.toBeInTheDocument()
    expect(appNav()).not.toBeInTheDocument()

    auth.emit(OWNER)
    expect(await screen.findByRole('heading', { level: 1, name: 'ホーム' })).toBeInTheDocument()
  })

  it.each(['/', '/study', '/materials', '/stats', '/settings', '/no-such-page'])(
    '未ログインでは %s を開いてもログイン画面になる',
    async (path) => {
      const { createRepositories } = setup({ initialUser: null, path })
      expect(await screen.findByRole('button', { name: 'Googleでログイン' })).toBeInTheDocument()
      expect(appNav()).not.toBeInTheDocument()
      expect(createRepositories).not.toHaveBeenCalled()
    },
  )

  it('ログインすると、開こうとしていた画面（学習）に入れる', async () => {
    const { user, auth, router } = setup({ initialUser: null, path: '/study' })
    await user.click(await screen.findByRole('button', { name: 'Googleでログイン' }))
    expect(auth.signInCalls).toEqual(['popup'])
    expect(await screen.findByRole('heading', { level: 1, name: '学習' })).toBeInTheDocument()
    expect(router.state.location.pathname).toBe('/study')
  })

  it('Owner 以外のアカウントでは「利用権限がありません」と表示し、アプリに入れない', async () => {
    const { user, createRepositories } = setup({ initialUser: STRANGER })
    expect(await screen.findByRole('heading', { name: 'このアカウントには利用権限がありません' })).toBeInTheDocument()
    expect(screen.getByText(/other@example.com/)).toBeInTheDocument()
    expect(appNav()).not.toBeInTheDocument()
    expect(createRepositories).not.toHaveBeenCalled()

    await user.click(screen.getByRole('button', { name: 'ログアウト' }))
    expect(await screen.findByRole('button', { name: 'Googleでログイン' })).toBeInTheDocument()
  })

  it('Owner UID が未設定なら、自分の UID と設定方法を表示する', async () => {
    setup({ initialUser: OWNER, ownerUid: null })
    expect(await screen.findByRole('heading', { name: 'このアカウントには利用権限がありません' })).toBeInTheDocument()
    expect(screen.getByText(OWNER.uid)).toBeInTheDocument()
    expect(screen.getAllByText('VITE_OWNER_UID').length).toBeGreaterThan(0)
  })

  it('Owner UID が設定済みなら、他人に UID の設定方法は表示しない', async () => {
    setup({ initialUser: STRANGER })
    await screen.findByRole('heading', { name: 'このアカウントには利用権限がありません' })
    expect(screen.queryByText(STRANGER.uid)).not.toBeInTheDocument()
  })

  it('設定画面からログアウトすると、保護された画面から出てログイン画面になる', async () => {
    const { user } = setup({ path: '/settings' })
    expect(await screen.findByText(OWNER.email as string)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'ログアウト' }))
    expect(await screen.findByRole('button', { name: 'Googleでログイン' })).toBeInTheDocument()
    expect(appNav()).not.toBeInTheDocument()
  })

  it('ログアウト → 再ログインでメモリ上のデータを作り直す（前のセッションの学習状態を引き継がない）', async () => {
    const { user, createRepositories } = setup({ path: '/settings' })
    await screen.findByRole('heading', { level: 1, name: '設定' })
    expect(createRepositories).toHaveBeenCalledTimes(1)

    await user.click(screen.getByRole('button', { name: 'ログアウト' }))
    await user.click(await screen.findByRole('button', { name: 'Googleでログイン' }))
    await screen.findByRole('heading', { level: 1, name: '設定' })
    expect(createRepositories).toHaveBeenCalledTimes(2)
  })

  it('画面を移動してもデータは作り直さない', async () => {
    const { user, createRepositories } = setup()
    await screen.findByRole('heading', { level: 1, name: 'ホーム' })
    await user.click(within(appNav() as HTMLElement).getByRole('link', { name: '教材' }))
    await screen.findByRole('heading', { level: 1, name: '教材' })
    expect(createRepositories).toHaveBeenCalledTimes(1)
  })

  it('ログイン後、FSRS の学習（答えを見る → Good → 保存 → 次の問題）がこれまでどおり動く', async () => {
    const repos = createSampleRepositories()
    const auth = createFakeAuthGateway({ initialUser: null })
    const user = userEvent.setup()
    renderApp({ auth, repos, clock: createTestClock(NOW).now, path: '/study' })

    await user.click(await screen.findByRole('button', { name: 'Googleでログイン' }))
    expect(await screen.findByText('城の中心となる曲輪を何という？')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '答えを見る' }))
    const ratings = screen.getByRole('group', { name: '自己評価' })
    expect(within(ratings).getByRole('button', { name: /^正解/ })).toHaveTextContent('10分')
    await user.click(within(ratings).getByRole('button', { name: /^正解/ }))

    expect(await screen.findByText('城の正面にあたる門を何という？')).toBeInTheDocument()
    const logs = await repos.reviews.listLogsForCard('sample-castle-3', 'castle-001', { limit: 5 })
    expect(logs.map((log) => log.rating)).toEqual(['good'])
  })

  it('ログイン後も存在しない URL は 404 画面', async () => {
    setup({ path: '/no-such-page' })
    expect(await screen.findByRole('heading', { name: 'ページが見つかりません' })).toBeInTheDocument()
  })
})

describe('ログイン失敗', () => {
  it('ログインに失敗したら日本語のエラーを表示し、もう一度押せる', async () => {
    const { user, auth } = setup({ initialUser: null })
    auth.signInImpl = () =>
      Promise.reject(new AppError('network', 'ネットワークに接続できませんでした。接続を確認して、もう一度お試しください。'))
    await user.click(await screen.findByRole('button', { name: 'Googleでログイン' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('ネットワークに接続できませんでした')
    expect(screen.getByRole('button', { name: 'Googleでログイン' })).toBeEnabled()
  })

  it('ポップアップを閉じた（取り消した）場合はエラーを表示しない', async () => {
    const { user, auth } = setup({ initialUser: null })
    auth.signInImpl = () => Promise.reject(new AppError('cancelled', 'ログインを取り消しました。'))
    await user.click(await screen.findByRole('button', { name: 'Googleでログイン' }))
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('リダイレクト方式のログインに失敗して戻ってきた場合もエラーを表示する', async () => {
    const auth = createFakeAuthGateway({ initialUser: null })
    auth.redirectResult = () =>
      Promise.reject(new AppError('configuration', 'このアドレスからのログインは許可されていません。'))
    renderApp({ auth, createRepositories: createSampleRepositories, path: '/' })
    expect(await screen.findByRole('alert')).toHaveTextContent('このアドレスからのログインは許可されていません。')
  })

  it('ポップアップがブロックされたら、localhost 以外ではリダイレクトでやり直す', async () => {
    const { user, auth } = setup({ initialUser: null })
    auth.signInImpl = (method) =>
      method === 'popup'
        ? Promise.reject(new AppError('popup-blocked', 'ブロックされました'))
        : Promise.resolve()
    await user.click(await screen.findByRole('button', { name: 'Googleでログイン' }))
    expect(auth.signInCalls).toEqual(['popup', 'redirect'])
  })

  it('localhost でポップアップがブロックされたら、リダイレクトせずに案内を表示する', async () => {
    const auth = createFakeAuthGateway({ initialUser: null })
    auth.signInImpl = () => Promise.reject(new AppError('popup-blocked', 'ポップアップがブロックされました。'))
    const user = userEvent.setup()
    renderApp({
      auth,
      createRepositories: createSampleRepositories,
      path: '/',
      environment: { hostname: 'localhost', isStandalone: false, isTouchPrimary: false },
    })
    await user.click(await screen.findByRole('button', { name: 'Googleでログイン' }))
    expect(auth.signInCalls).toEqual(['popup'])
    expect(await screen.findByRole('alert')).toHaveTextContent('ポップアップがブロックされました。')
  })

  it('ホーム画面に追加した PWA ではリダイレクト方式でログインする', async () => {
    const auth = createFakeAuthGateway({ initialUser: null })
    const user = userEvent.setup()
    renderApp({
      auth,
      createRepositories: createSampleRepositories,
      path: '/',
      environment: { hostname: 'demo.firebaseapp.com', isStandalone: true, isTouchPrimary: true },
    })
    await user.click(await screen.findByRole('button', { name: 'Googleでログイン' }))
    expect(auth.signInCalls).toEqual(['redirect'])
  })
})

describe('Firebase の設定がない場合', () => {
  it('不足している変数名と README の案内を表示する', () => {
    render(<ConfigErrorPage missing={['VITE_FIREBASE_API_KEY', 'VITE_FIREBASE_PROJECT_ID']} />)
    expect(screen.getByRole('heading', { name: 'Firebase の設定が見つかりません' })).toBeInTheDocument()
    expect(screen.getByText('VITE_FIREBASE_API_KEY')).toBeInTheDocument()
    expect(screen.getByText('VITE_FIREBASE_PROJECT_ID')).toBeInTheDocument()
    expect(screen.getByText(/README\.md/)).toBeInTheDocument()
  })
})
