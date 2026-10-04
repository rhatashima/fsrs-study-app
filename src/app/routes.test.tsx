import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter } from 'react-router'
import { RouterProvider } from 'react-router/dom'
import { describe, expect, it } from 'vitest'
import { NAV_ITEMS } from './navigation'
import { routes } from './routes'

function renderAt(path: string) {
  const router = createMemoryRouter(routes, { initialEntries: [path] })
  render(<RouterProvider router={router} />)
  return router
}

describe('routes', () => {
  it.each([
    ['/', 'ホーム'],
    ['/study', '学習'],
    ['/materials', '教材'],
    ['/stats', '成績'],
    ['/settings', '設定'],
  ])('URL %s を直接開くと「%s」画面を表示する', async (path, title) => {
    renderAt(path)
    expect(await screen.findByRole('heading', { level: 1, name: title })).toBeInTheDocument()
  })

  it('タブバーに 5 画面へのリンクがあり、現在の画面が選択状態になる', async () => {
    renderAt('/stats')
    const nav = await screen.findByRole('navigation', { name: 'メインメニュー' })
    const links = nav.querySelectorAll('a')
    expect(Array.from(links, (a) => a.textContent)).toEqual(NAV_ITEMS.map((item) => item.label))
    expect(screen.getByRole('link', { name: '成績' })).toHaveAttribute('aria-current', 'page')
    expect(screen.getByRole('link', { name: 'ホーム' })).not.toHaveAttribute('aria-current')
  })

  it('タブを押すと画面が切り替わり、戻る操作で前の画面に戻る', async () => {
    const user = userEvent.setup()
    const router = renderAt('/')
    await user.click(await screen.findByRole('link', { name: '教材' }))
    expect(await screen.findByRole('heading', { level: 1, name: '教材' })).toBeInTheDocument()
    expect(router.state.location.pathname).toBe('/materials')

    await router.navigate(-1)
    expect(await screen.findByRole('heading', { level: 1, name: 'ホーム' })).toBeInTheDocument()
  })

  it('存在しない URL では「ページが見つかりません」を表示する', async () => {
    renderAt('/no-such-page')
    expect(
      await screen.findByRole('heading', { level: 1, name: 'ページが見つかりません' }),
    ).toBeInTheDocument()
  })
})
