/** 教材インポート：ファイルの読み取り → 正規化・検証 → 既存カードとの比較（プレビュー）→ 保存 → 集計の作り直し */
export { executeImport, IMPORT_CHUNK_SIZE, rebuildMaterialProgress, type ImportResult } from './execute'
export { detectFormat, MAX_IMPORT_ROWS, parseImportFile } from './parse'
export { diffImport, planImport, type ImportAction, type ImportCounts, type ImportPlan, type PlannedCard } from './plan'
export type { ImportCardDto, ImportField, ImportFormat, ImportIssue, ParsedImport } from './types'
