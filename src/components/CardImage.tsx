import { useState } from 'react'
import styles from './StudyCard.module.css'

/** 画像付きカードの画像。読み込みに失敗しても学習を続けられるよう代替表示にする */
export function CardImage({ src }: { src: string }) {
  const [failedSrc, setFailedSrc] = useState<string | null>(null)
  if (failedSrc === src) {
    return (
      <p className={styles.imageError} role="note">
        画像を読み込めませんでした
      </p>
    )
  }
  return (
    <img
      className={styles.image}
      src={src}
      alt="問題の画像"
      onError={() => setFailedSrc(src)}
    />
  )
}
