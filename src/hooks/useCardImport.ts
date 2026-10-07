import { useCallback, useEffect, useRef, useState } from 'react'
import { useClock } from '../app/clockContext'
import { useRepositories } from '../app/repositoryContext'
import type { StudyMaterial } from '../domain'
import { errorMessage } from '../lib/errorMessage'
import { perfAsync } from '../lib/perf'
import {
  executeImport,
  parseImportFile,
  planImport,
  rebuildMaterialProgress,
  type ImportIssue,
  type ImportPlan,
  type ImportResult,
} from '../services/import'

/**
 * インポート画面の状態：
 * ファイル選択 → 読み取り・検証 → プレビュー（保存はまだ）→ 実行（進捗）→ 結果
 */
export type ImportView =
  | { status: 'loading' }
  | { status: 'not-found' }
  | { status: 'load-error'; message: string }
  | { status: 'select'; material: StudyMaterial }
  | { status: 'checking'; material: StudyMaterial; fileName: string }
  | {
      status: 'invalid'
      material: StudyMaterial
      fileName: string
      totalRows: number
      errors: ImportIssue[]
      warnings: string[]
    }
  | { status: 'preview'; material: StudyMaterial; fileName: string; plan: ImportPlan; warnings: string[] }
  | { status: 'importing'; material: StudyMaterial; fileName: string; done: number; total: number }
  | {
      status: 'finished'
      material: StudyMaterial
      fileName: string
      result: ImportResult
      rebuilding: boolean
    }

export function useCardImport(materialId: string) {
  const repos = useRepositories()
  const clock = useClock()
  const [view, setView] = useState<ImportView>({ status: 'loading' })
  /** 実行中か（二重に始めない） */
  const runningRef = useRef(false)

  useEffect(() => {
    let cancelled = false
    repos.materials
      .get(materialId)
      .then((material) => {
        if (!cancelled) setView(material ? { status: 'select', material } : { status: 'not-found' })
      })
      .catch((error: unknown) => {
        if (!cancelled) setView({ status: 'load-error', message: errorMessage(error, '教材を読み込めませんでした。') })
      })
    return () => {
      cancelled = true
    }
  }, [repos, materialId])

  const material = 'material' in view ? view.material : null

  /** ファイルを読み、検証し、既存カードと比べてプレビューを作る（保存はしない） */
  const selectFile = useCallback(
    async (file: File) => {
      if (!material || runningRef.current) return
      setView({ status: 'checking', material, fileName: file.name })
      try {
        const text = await file.text()
        const parsed = parseImportFile(file.name, text, material.id)
        if (parsed.errors.length > 0) {
          setView({
            status: 'invalid',
            material,
            fileName: file.name,
            totalRows: parsed.totalRows,
            errors: parsed.errors,
            warnings: parsed.warnings,
          })
          return
        }
        const plan = await planImport(repos, material.id, parsed.rows, clock())
        setView({ status: 'preview', material, fileName: file.name, plan, warnings: parsed.warnings })
      } catch (error) {
        setView({
          status: 'invalid',
          material,
          fileName: file.name,
          totalRows: 0,
          errors: [{ where: 'ファイル全体', message: errorMessage(error, 'ファイルを読み込めませんでした。') }],
          warnings: [],
        })
      }
    },
    [material, repos, clock],
  )

  /** 取り込みを実行する（二重には始めない） */
  const execute = useCallback(async () => {
    if (view.status !== 'preview' || runningRef.current) return
    runningRef.current = true
    const { plan, fileName } = view
    const total = plan.counts.new + plan.counts.update
    setView({ status: 'importing', material: view.material, fileName, done: 0, total })
    try {
      const result = await perfAsync(
        'import:execute',
        () =>
          executeImport(repos, plan, {
            now: clock(),
            onProgress: (done, totalWrites) =>
              setView({ status: 'importing', material: view.material, fileName, done, total: totalWrites }),
          }),
        (r) => ({ new: r.new, update: r.update, failed: r.failed }),
      )
      setView({ status: 'finished', material: view.material, fileName, result, rebuilding: false })
    } finally {
      runningRef.current = false
    }
  }, [view, repos, clock])

  /** 集計の作り直しだけをやり直す（取り込み後の作り直しに失敗したとき） */
  const rebuildProgress = useCallback(async () => {
    if (view.status !== 'finished' || view.rebuilding) return
    setView({ ...view, rebuilding: true })
    try {
      await rebuildMaterialProgress(repos, view.material.id, clock())
      setView({ ...view, rebuilding: false, result: { ...view.result, progressRebuilt: true, progressError: null } })
    } catch (error) {
      setView({
        ...view,
        rebuilding: false,
        result: { ...view.result, progressError: errorMessage(error, '集計を作り直せませんでした。') },
      })
    }
  }, [view, repos, clock])

  /** 別のファイルを選び直す */
  const reset = useCallback(() => {
    if (material && !runningRef.current) setView({ status: 'select', material })
  }, [material])

  return { view, selectFile, execute, rebuildProgress, reset }
}
