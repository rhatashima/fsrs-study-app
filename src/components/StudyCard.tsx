import { categoryLabel, type Card } from '../domain'
import { CardImage } from './CardImage'
import styles from './StudyCard.module.css'

interface StudyCardProps {
  card: Card
  revealed: boolean
}

/** 問題（と、答えを表示した後は正答・解説） */
export function StudyCard({ card, revealed }: StudyCardProps) {
  return (
    <article className={styles.card} aria-label="問題">
      <p className={styles.category}>{categoryLabel(card)}</p>
      {card.imageUrl && <CardImage key={card.imageUrl} src={card.imageUrl} />}
      <p className={styles.question}>{card.question}</p>
      {revealed && (
        <section className={styles.answerBlock} aria-label="答え">
          <p className={styles.answer}>{card.answer}</p>
          {card.explanation && <p className={styles.explanation}>{card.explanation}</p>}
        </section>
      )}
    </article>
  )
}
