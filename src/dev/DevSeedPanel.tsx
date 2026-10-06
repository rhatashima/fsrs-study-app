import { useState } from 'react'
import { useClock } from '../app/clockContext'
import { useRepositories } from '../app/repositoryContext'
import { errorMessage } from '../lib/errorMessage'
import styles from '../pages/Page.module.css'
import { seedSampleData } from '../services/devSeed'

/**
 * 開発サーバー（npm run dev）でだけ表示する、ダミーデータの投入ボタン。
 * 本番ビルドには含まれない（SettingsPage で import.meta.env.DEV のときだけ読み込む）。
 */
export default function DevSeedPanel() {
  const repos = useRepositories()
  const clock = useClock()
  const [message, setMessage] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const seed = async () => {
    setBusy(true)
    setMessage(null)
    try {
      const result = await seedSampleData(repos, clock())
      setMessage(`ダミーデータを投入しました（教材 ${result.materials} 件・カード ${result.cards} 枚）。`)
    } catch (error) {
      setMessage(errorMessage(error, 'ダミーデータを投入できませんでした。'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className={styles.panel}>
      <h2>開発用</h2>
      <p className={styles.muted}>
        ダミー教材（日本城郭検定3級・テスト用教材）を、ログイン中のアカウントのデータに入れます。学習状態・学習履歴は変更しません。
      </p>
      {message && <p role="status">{message}</p>}
      <button type="button" className={styles.primaryButton} onClick={() => void seed()} disabled={busy}>
        {busy ? '投入中…' : 'ダミーデータを投入'}
      </button>
    </div>
  )
}
