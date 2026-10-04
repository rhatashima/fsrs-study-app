import styles from './Page.module.css'

export function StudyPage() {
  return (
    <section className={styles.page}>
      <h1 className={styles.title}>学習</h1>
      <div className={styles.panel}>
        <p className={styles.muted}>学習できるカードはまだありません。</p>
      </div>
    </section>
  )
}
