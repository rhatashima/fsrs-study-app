import styles from './Page.module.css'

export function StatsPage() {
  return (
    <section className={styles.page}>
      <h1 className={styles.title}>成績</h1>
      <div className={styles.panel}>
        <p className={styles.muted}>学習を始めると、ここに成績が表示されます。</p>
      </div>
    </section>
  )
}
