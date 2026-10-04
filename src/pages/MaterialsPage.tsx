import styles from './Page.module.css'

export function MaterialsPage() {
  return (
    <section className={styles.page}>
      <h1 className={styles.title}>教材</h1>
      <div className={styles.panel}>
        <p className={styles.muted}>教材はまだ登録されていません。</p>
      </div>
    </section>
  )
}
