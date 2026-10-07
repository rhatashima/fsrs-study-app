import Papa from 'papaparse'
import { KNOWN_KEYS, normalizeRecord } from './normalize'
import type { ImportCardDto, ImportFormat, ImportIssue, ParsedImport } from './types'

/** 1 回に取り込める件数の上限（誤ったファイルを選んだときの保護） */
export const MAX_IMPORT_ROWS = 5000

const WHOLE_FILE = 'ファイル全体'
/** UTF-8 の BOM（先頭の目印）。Excel で保存した CSV などに付いている */
const BOM_PATTERN = /^\uFEFF/

/** ファイル名（拡張子）と中身から形式を決める */
export function detectFormat(fileName: string, text: string): ImportFormat {
  const lower = fileName.toLowerCase()
  if (lower.endsWith('.json')) return 'json'
  if (lower.endsWith('.csv')) return 'csv'
  const head = text.replace(BOM_PATTERN, '').trimStart()
  return head.startsWith('[') || head.startsWith('{') ? 'json' : 'csv'
}

/**
 * CSV / JSON を読み、正規化・検証する（保存はしない）。
 * エラーが 1 件でもあれば、呼び出し側は取り込みを行わない。
 */
export function parseImportFile(fileName: string, text: string, selectedMaterialId: string): ParsedImport {
  const format = detectFormat(fileName, text)
  const parsed = format === 'csv' ? readCsv(text) : readJson(text)
  if (parsed.records.length > MAX_IMPORT_ROWS) {
    parsed.errors.push({
      where: WHOLE_FILE,
      message: `件数が多すぎます（${parsed.records.length} 件）。1 回に取り込めるのは ${MAX_IMPORT_ROWS} 件までです。ファイルを分けてください。`,
    })
  }

  const rows: ImportCardDto[] = []
  const errors: ImportIssue[] = [...parsed.errors]
  for (const { raw, where } of parsed.records) {
    const result = normalizeRecord(raw, where, selectedMaterialId)
    errors.push(...result.errors)
    if (result.dto) rows.push(result.dto)
  }

  // ファイル内の id の重複（ほかの項目にエラーがある行も含めて調べる）
  const seen = new Map<string, string>()
  for (const { raw, where } of parsed.records) {
    const id = typeof raw['id'] === 'string' ? raw['id'].trim() : typeof raw['id'] === 'number' ? String(raw['id']) : ''
    if (id === '') continue
    const first = seen.get(id)
    if (first) errors.push({ where, message: `id「${id}」が ${first} と重複しています。` })
    else seen.set(id, where)
  }

  return { format, totalRows: parsed.records.length, rows, errors, warnings: parsed.warnings }
}

interface RawRecords {
  records: { raw: Record<string, unknown>; where: string }[]
  errors: ImportIssue[]
  warnings: string[]
}

/** CSV：見出し行あり、カンマ区切り、UTF-8（BOM 付きも可）。表計算ソフトの行番号（見出し = 1 行目）で位置を示す */
function readCsv(text: string): RawRecords {
  const result = Papa.parse<Record<string, string>>(text.replace(BOM_PATTERN, ''), {
    header: true,
    delimiter: ',',
    skipEmptyLines: 'greedy',
    transformHeader: (header) => header.trim(),
  })
  const errors: ImportIssue[] = []
  const warnings: string[] = []
  const fields = result.meta.fields ?? []
  const rowLabel = (index: number) => `${index + 2} 行目`

  for (const required of ['id', 'question', 'answer']) {
    if (!fields.includes(required)) errors.push({ where: WHOLE_FILE, message: `必須の列「${required}」がありません。` })
  }
  if (fields.includes('examDifficulty') && fields.includes('difficulty')) {
    errors.push({
      where: WHOLE_FILE,
      message: '列 examDifficulty と difficulty の両方があります。どちらか一方（examDifficulty）だけにしてください。',
    })
  }
  const unknown = fields.filter((field) => field !== '' && !KNOWN_KEYS.has(field))
  if (unknown.length > 0) warnings.push(`次の列は使わずに無視します：${unknown.join('、')}`)

  const reported = new Set<number>()
  for (const error of result.errors) {
    const index = error.row ?? -1
    if (reported.has(index)) continue
    reported.add(index)
    const where = index >= 0 ? rowLabel(index) : WHOLE_FILE
    if (error.code === 'MissingQuotes') {
      errors.push({ where, message: 'ダブルクォート（"）が閉じられていません。' })
    } else if (error.code === 'TooFewFields' || error.code === 'TooManyFields') {
      errors.push({ where, message: `列の数が見出し行（${fields.length} 列）と違います。` })
    } else {
      errors.push({ where, message: 'CSV として読み取れません。' })
    }
  }

  const records = result.data.map((row, index) => {
    // 列がない項目は undefined のまま（＝ファイルに含まれていない）
    const raw: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(row)) if (KNOWN_KEYS.has(key)) raw[key] = value
    return { raw, where: rowLabel(index) }
  })
  return { records, errors, warnings }
}

/** JSON：カードの配列（{ "cards": [...] } も可） */
function readJson(text: string): RawRecords {
  let data: unknown
  try {
    data = JSON.parse(text.replace(BOM_PATTERN, ''))
  } catch {
    return {
      records: [],
      errors: [{ where: WHOLE_FILE, message: 'JSON として読み取れません。カンマや括弧（[ ] { }）、ダブルクォートの対応を確認してください。' }],
      warnings: [],
    }
  }
  const list = Array.isArray(data)
    ? data
    : isObject(data) && Array.isArray(data['cards'])
      ? (data['cards'] as unknown[])
      : null
  if (!list) {
    return {
      records: [],
      errors: [{ where: WHOLE_FILE, message: 'JSON はカードの配列（[ {...}, {...} ]）にしてください。' }],
      warnings: [],
    }
  }
  const errors: ImportIssue[] = []
  const unknown = new Set<string>()
  const records: RawRecords['records'] = []
  list.forEach((item, index) => {
    const where = `${index + 1} 件目`
    if (!isObject(item)) {
      errors.push({ where, message: 'カードはオブジェクト（{ ... }）で指定してください。' })
      return
    }
    for (const key of Object.keys(item)) if (!KNOWN_KEYS.has(key)) unknown.add(key)
    const raw: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(item)) if (KNOWN_KEYS.has(key)) raw[key] = value
    records.push({ raw, where })
  })
  const warnings = unknown.size > 0 ? [`次の項目は使わずに無視します：${[...unknown].join('、')}`] : []
  return { records, errors, warnings }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}
