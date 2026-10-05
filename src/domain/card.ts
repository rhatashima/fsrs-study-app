/** 作成者が付ける 1〜5 の段階値（問題の難易度・重要度） */
export type Level = 1 | 2 | 3 | 4 | 5

export function isLevel(value: unknown): value is Level {
  return value === 1 || value === 2 || value === 3 || value === 4 || value === 5
}

/**
 * 問題（教材の中身）。学習に関する値（FSRS の状態・評価回数など）は一切持たない。
 * それらは cardId をキーにした ReviewState / ReviewLog に分けて保存する。
 */
export interface Card {
  /** インポートファイルで指定する id。教材内で一意 */
  id: string
  materialId: string
  question: string
  answer: string
  /** 解説（空文字可） */
  explanation: string
  /** 空文字の場合は「未分類」として扱う */
  category: string
  subcategory?: string
  tags: string[]
  /**
   * 問題そのものの難易度（作成者が付ける）。
   * FSRS が計算する記憶の難易度（ReviewState.difficulty）とは無関係。
   */
  examDifficulty?: Level
  /** 重要度（作成者が付ける） */
  importance?: Level
  /** https の URL または /images/... のパス */
  imageUrl?: string
  source?: string
  notes?: string
  /**
   * 新規カードを出す順番（1 以上の整数）。新規作成時に教材内の最大値 + 1 を採番し、
   * カードを更新しても変えない。
   */
  order: number
  /** true のカードは出題・集計の対象外。履歴は残る */
  isArchived: boolean
  createdAt: Date
  updatedAt: Date
}

/** Firestore のドキュメント id としても安全な文字だけを許可する */
export const CARD_ID_PATTERN = /^[A-Za-z0-9_-]{1,100}$/

export function isValidCardId(id: string): boolean {
  return CARD_ID_PATTERN.test(id)
}

export const UNCATEGORIZED_LABEL = '未分類'

export function categoryLabel(card: Pick<Card, 'category'>): string {
  const category = card.category.trim()
  return category === '' ? UNCATEGORIZED_LABEL : category
}
