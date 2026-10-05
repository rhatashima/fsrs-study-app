import styles from './Page.module.css'

/** Firebase の設定（.env.local）が不足しているときの画面。不足している変数名だけを表示する（値は表示しない） */
export function ConfigErrorPage({ missing }: { missing: readonly string[] }) {
  return (
    <main className={`${styles.page} ${styles.standalone}`}>
      <h1 className={styles.title}>Firebase の設定が見つかりません</h1>
      <p>
        <code>.env.local</code> に次の値が設定されていません。README.md の「Firebase Authentication
        の設定」を見て設定し、開発サーバーを再起動してください。
      </p>
      <ul>
        {missing.map((key) => (
          <li key={key}>
            <code>{key}</code>
          </li>
        ))}
      </ul>
    </main>
  )
}
