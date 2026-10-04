import styles from './Page.module.css'

export function SettingsPage() {
  return (
    <section className={styles.page}>
      <h1 className={styles.title}>設定</h1>
      <div className={styles.panel}>
        <p className={styles.muted}>設定項目は今後追加されます。</p>
      </div>
    </section>
  )
}
