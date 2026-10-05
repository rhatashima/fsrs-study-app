export const DEFAULT_NEW_CARDS_PER_DAY = 10

/** 教材（例：日本城郭検定3級）。学習の進み具合は MaterialProgress に分けて持つ。 */
export interface StudyMaterial {
  id: string
  title: string
  description: string
  /** false の教材はホームで選べない */
  isActive: boolean
  /** 1 日に導入する新規カードの上限 */
  newCardsPerDay: number
  createdAt: Date
  updatedAt: Date
}
