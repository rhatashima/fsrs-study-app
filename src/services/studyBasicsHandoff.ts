import type { StudyBasics } from './studyService'

/** ホーム画面で読んだ基本データを、学習開始で再利用してよい時間 */
export const STUDY_BASICS_MAX_AGE_MS = 60_000

/**
 * ホーム画面 → 学習開始の、基本データ（設定・教材・集計・期限カードの学習状態）の受け渡し。
 * - 永続的なキャッシュではない：1 回取り出したら消え、60 秒を過ぎたもの・学習日が変わったものは使わない
 * - 利用者ごとに作り、ログアウトで捨てる（AuthGate）
 * 他の端末で直前に学習していて古くなっていても、レビュー保存時のトランザクションが保存済みの状態と照合するため、
 * データは壊れない（その場合は「別の端末などで先に学習されています」になる）。
 */
export class StudyBasicsHandoff {
  private basics: StudyBasics | null = null

  put(basics: StudyBasics): void {
    this.basics = basics
  }

  /** 再利用できる基本データを取り出す（なければ null） */
  take(now: Date): StudyBasics | null {
    const basics = this.basics
    this.basics = null
    if (!basics) return null
    const age = now.getTime() - basics.loadedAt.getTime()
    if (age < 0 || age > STUDY_BASICS_MAX_AGE_MS) return null
    if (now.getTime() >= basics.dayEnd.getTime()) return null
    return basics
  }
}
