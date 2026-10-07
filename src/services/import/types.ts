import type { Level } from '../../domain'

/*
 * 教材インポートの型。CSV / JSON から読んだ内容は、まずこの「取り込み用の 1 件（DTO）」にし、
 * 既存カードとの比較（diff）を経てから Domain の Card にする（Card 型にファイル固有の事情を混ぜない）。
 */

export type ImportFormat = 'csv' | 'json'

/** ファイルの項目のうち、カードの内容として取り込むもの */
export const IMPORT_FIELDS = [
  'question',
  'answer',
  'explanation',
  'category',
  'subcategory',
  'tags',
  'examDifficulty',
  'importance',
  'imageUrl',
  'source',
  'notes',
  'order',
] as const
export type ImportField = (typeof IMPORT_FIELDS)[number]

/** 取り込み用の 1 件（正規化・検証済み） */
export interface ImportCardDto {
  /** エラー表示用の位置（例：「3 行目」「2 件目」） */
  rowLabel: string
  id: string
  question: string
  answer: string
  explanation?: string
  category?: string
  subcategory?: string
  tags?: string[]
  examDifficulty?: Level
  importance?: Level
  imageUrl?: string
  source?: string
  notes?: string
  order?: number
  /**
   * ファイルに含まれていた項目。含まれていない項目は、既存カードを更新するときに元の値を残す。
   * 含まれていて空の項目は、値を消す（任意項目）・空にする（解説・カテゴリー）。
   */
  provided: ReadonlySet<ImportField>
}

/** 検証エラー（何行目の何が問題か） */
export interface ImportIssue {
  /** 例：「3 行目」「2 件目」「ファイル全体」 */
  where: string
  message: string
}

export interface ParsedImport {
  format: ImportFormat
  /** データの件数（見出し行を除く） */
  totalRows: number
  /** 検証を通った行（エラーがあれば取り込みは行わない） */
  rows: ImportCardDto[]
  errors: ImportIssue[]
  /** 取り込みは止めないが知らせること（未対応の列など） */
  warnings: string[]
}
