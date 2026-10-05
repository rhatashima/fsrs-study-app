import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { createSampleRepositories } from '../dev/sampleRepositories'
import { renderApp } from '../test/renderApp'
import { NAV_ITEMS } from './navigation'

/** Owner としてログイン済みの状態で表示する */
function renderAt(path: string) {
  return renderApp({ createRepositories: createSampleRepositories, path }).router
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

  it('教材画面にメモリ上の教材名とカード数（アーカイブ除く）を表示する', async () => {
    renderAt('/materials')
    const castle = await screen.findByRole('article', { name: '日本城郭検定3級' })
    expect(castle).toHaveTextContent('カード 15 枚（未学習 15 枚）')
    const test = screen.getByRole('article', { name: 'テスト用教材' })
    expect(test).toHaveTextContent('カード 4 枚（未学習 4 枚）')
  })

  it('存在しない URL では「ページが見つかりません」を表示する', async () => {
    renderAt('/no-such-page')
    expect(
      await screen.findByRole('heading', { level: 1, name: 'ページが見つかりません' }),
    ).toBeInTheDocument()
  })
})
