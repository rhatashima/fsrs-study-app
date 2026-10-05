import type {
  AppSettings,
  Card,
  MaterialProgress,
  ReviewLog,
  ReviewProgressContext,
  ReviewState,
  SchedulerConfig,
  StudyMaterial,
} from '../domain'

/*
 * データ層のインターフェース。UI・サービスはこれだけに依存し、実装（メモリ / Firestore）を知らない。
 * - 「必要な分だけ」を取るメソッドにする（教材の全件読み込みを前提にしない）
 * - 取得した値を書き換えても保存済みデータには影響しない（実装はコピーを返す）
 * - 失敗時は AppError を投げる
 */

export interface MaterialRepository {
  list(): Promise<StudyMaterial[]>
  get(materialId: string): Promise<StudyMaterial | null>
  /** 作成または更新 */
  save(material: StudyMaterial): Promise<void>
}

export interface CardRepository {
  /** 指定 id のカードを返す（存在しない id は結果に含めない。順序は ids の順） */
  getByIds(materialId: string, cardIds: readonly string[]): Promise<Card[]>
  /** 新規カードの候補：アーカイブされておらず order > afterOrder のカードを order 順に limit 件 */
  listNewCandidates(materialId: string, options: { afterOrder: number; limit: number }): Promise<Card[]>
  /** アーカイブされていないカードの件数 */
  countActive(materialId: string): Promise<number>
  /** 作成または更新（Card のみ。ReviewState / ReviewLog には触れない） */
  saveMany(cards: readonly Card[]): Promise<void>
}

/** 1 回のレビュー結果。recordReview でアトミックに保存される */
export interface ReviewRecord {
  /** レビュー後の状態（lastLogId === log.id、FSRS 部分は log.nextState と一致すること） */
  state: ReviewState
  /** 追記する履歴 */
  log: ReviewLog
  /** 集計（MaterialProgress）の更新に必要な情報 */
  context: ReviewProgressContext
}

/**
 * 学習記録（ReviewState・ReviewLog・MaterialProgress）。
 * 1 回のレビューでこの 3 つを同時に更新する必要があるため、1 つのリポジトリにまとめている。
 * ReviewLog は追記のみ：既存の ReviewLog を変更・削除するメソッドは意図的に用意しない。
 */
export interface ReviewRepository {
  /** 指定カードの ReviewState（未学習のカードは結果に含まれない） */
  getStates(materialId: string, cardIds: readonly string[]): Promise<ReviewState[]>
  /**
   * 期限が dueBefore より前（一時停止でない）の ReviewState を期限の早い順に返す。
   * 学習セッションでは dueBefore = 学習日の終わり。limit 省略時は全件
   * （Review の 1 日の上限は設けないため。取得件数は「今日の学習量」に比例する）。
   */
  listDue(materialId: string, options: { dueBefore: Date; limit?: number }): Promise<ReviewState[]>
  /** ReviewState の保存・ReviewLog の追記・集計の加算をすべて行うか、何も行わない */
  recordReview(record: ReviewRecord): Promise<void>
  /** カードの ReviewLog を新しい順に limit 件（状態の復元・監査用） */
  listLogsForCard(materialId: string, cardId: string, options: { limit: number }): Promise<ReviewLog[]>
  /** 教材の集計（まだ学習記録がなければ空の集計） */
  getProgress(materialId: string): Promise<MaterialProgress>
}

export interface SettingsRepository {
  /** 保存されていなければ既定値 */
  getSettings(): Promise<AppSettings>
  saveSettings(settings: AppSettings): Promise<void>
  getSchedulerConfig(configId: string): Promise<SchedulerConfig | null>
  /** 作成のみ（不変）。同じ id・同じ内容（作成日時以外）なら何もしない。同じ id で内容が違えば conflict */
  saveSchedulerConfig(config: SchedulerConfig): Promise<void>
}

export interface Repositories {
  materials: MaterialRepository
  cards: CardRepository
  reviews: ReviewRepository
  settings: SettingsRepository
}
