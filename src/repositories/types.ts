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
  /** 教材内のカードの order の最大値（カードがなければ 0。アーカイブ済みも含む）。新規カードの採番に使う */
  getMaxOrder(materialId: string): Promise<number>
  /**
   * 教材のすべてのカード（アーカイブ済みも含む）。
   * 全件を読むため、利用者が明示的に実行する処理（インポート後・手動の再集計）でだけ使う
   */
  listAll(materialId: string): Promise<Card[]>
  /**
   * 作成または更新（Card のみ。ReviewState / ReviewLog には触れない）。
   * 1 回の呼び出しの中身はすべて保存されるか、何も保存されない（呼び出し側は 1 回 400 件以下にする）
   */
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
 *
 * 保存されている ReviewState が壊れている場合、getStates / listDue は
 * CorruptedReviewStateError を投げる（黙って除外・修復しない。復元は restoreState で明示的に行う）。
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
  /**
   * ReviewState の保存・ReviewLog の追記・集計の加算をすべて行うか、何も行わない。
   * - 同じ id・同じ内容の ReviewLog がすでにある（再試行・二重送信）：何もせず成功（冪等）
   * - 同じ id で内容が違う：conflict
   * - 保存されている ReviewState が log.previousState と一致しない（別の端末で先に学習された等）：conflict
   */
  recordReview(record: ReviewRecord): Promise<void>
  /** カードの有効な ReviewLog を新しい順に limit 件（状態の復元・監査用。形式が壊れた履歴は含めない） */
  listLogsForCard(materialId: string, cardId: string, options: { limit: number }): Promise<ReviewLog[]>
  /**
   * 教材のすべての ReviewState。全件を読むため、集計の作り直し（インポート後・手動の再集計）でだけ使う。
   * 壊れたものがあれば CorruptedReviewStateError
   */
  listAllStates(materialId: string): Promise<ReviewState[]>
  /** 指定カードのうち、ReviewLog が 1 件以上あるカードの id（ReviewState の欠落の検出用） */
  findCardsWithLogs(materialId: string, cardIds: readonly string[]): Promise<string[]>
  /**
   * 履歴から復元した ReviewState を保存する（ReviewLog・集計は変えない）。
   * state.lastLogId の ReviewLog が存在し、その nextState と一致する場合だけ保存する（違えば invalid-data）。
   */
  restoreState(state: ReviewState): Promise<void>
  /** 教材の集計（まだ学習記録がなければ空の集計） */
  getProgress(materialId: string): Promise<MaterialProgress>
  /** 集計を丸ごと置き換える（全件からの再集計・初期データの投入用） */
  replaceProgress(progress: MaterialProgress): Promise<void>
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
