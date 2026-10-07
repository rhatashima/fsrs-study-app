import { useEffect, type ChangeEvent } from 'react'
import { Link, useParams } from 'react-router'
import { useCardImport, type ImportView } from '../hooks/useCardImport'
import type { ImportPlan, ImportResult } from '../services/import'
import styles from './Page.module.css'
import importStyles from './ImportPage.module.css'

/** 画面に一度に出すエラーの数（多すぎると読めないため） */
const MAX_SHOWN_ERRORS = 50

const FIELD_LABELS: Record<string, string> = {
  question: '問題',
  answer: '答え',
  explanation: '解説',
  category: 'カテゴリー',
  subcategory: 'サブカテゴリー',
  tags: 'タグ',
  examDifficulty: '難易度',
  importance: '重要度',
  imageUrl: '画像',
  source: '出典',
  notes: 'メモ',
  order: '並び順',
}

export function ImportPage() {
  const { materialId = '' } = useParams()
  const { view, selectFile, execute, rebuildProgress, reset } = useCardImport(materialId)

  // 取り込み中にページを閉じようとしたら確認を出す
  const importing = view.status === 'importing'
  useEffect(() => {
    if (!importing) return
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault()
    }
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => window.removeEventListener('beforeunload', onBeforeUnload)
  }, [importing])

  const onFile = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (file) void selectFile(file)
  }

  return (
    <section className={styles.page}>
      <h1 className={styles.title}>問題をインポート</h1>
      {view.status === 'loading' && <p className={styles.muted}>読み込み中…</p>}
      {view.status === 'not-found' && <p role="alert">教材が見つかりません。</p>}
      {view.status === 'load-error' && <p role="alert">{view.message}</p>}
      {'material' in view && <p className={styles.muted}>取り込み先：{view.material.title}</p>}
      {(view.status === 'select' || view.status === 'invalid' || view.status === 'preview') && (
        <FilePicker onFile={onFile} />
      )}
      {view.status === 'checking' && <p className={styles.muted}>{view.fileName} を確認しています…</p>}
      {view.status === 'invalid' && <Invalid view={view} />}
      {view.status === 'preview' && <Preview view={view} onExecute={() => void execute()} />}
      {view.status === 'importing' && (
        <div className={styles.panel} role="status">
          <p>取り込んでいます… {view.done} / {view.total} 件</p>
          <progress className={importStyles.progress} max={view.total || 1} value={view.done} />
          <p className={styles.muted}>終わるまでこの画面を閉じないでください。</p>
        </div>
      )}
      {view.status === 'finished' && (
        <Finished
          result={view.result}
          rebuilding={view.rebuilding}
          onRebuild={() => void rebuildProgress()}
          onAgain={reset}
        />
      )}
      <Link to="/materials">教材の一覧に戻る</Link>
    </section>
  )
}

function FilePicker({ onFile }: { onFile: (event: ChangeEvent<HTMLInputElement>) => void }) {
  return (
    <div className={styles.panel}>
      <label className={importStyles.fileLabel}>
        CSV / JSON ファイルを選ぶ
        <input type="file" accept=".csv,.json,text/csv,application/json" onChange={onFile} />
      </label>
      <p className={styles.muted}>
        選んだだけでは保存しません。内容を確認してから「インポートを実行」を押してください。ファイルにない問題は削除しません。
      </p>
    </div>
  )
}

function Invalid({ view }: { view: Extract<ImportView, { status: 'invalid' }> }) {
  return (
    <div className={styles.panel} role="alert">
      <h2>取り込めません（{view.errors.length} 件の問題）</h2>
      <p>
        {view.fileName}（{view.totalRows} 件）に次の問題があります。ファイルを直してから選び直してください。何も保存していません。
      </p>
      <ul className={importStyles.issues}>
        {view.errors.slice(0, MAX_SHOWN_ERRORS).map((issue, index) => (
          <li key={index}>
            <strong>{issue.where}</strong>：{issue.message}
          </li>
        ))}
      </ul>
      {view.errors.length > MAX_SHOWN_ERRORS && <p>ほか {view.errors.length - MAX_SHOWN_ERRORS} 件</p>}
      <Warnings warnings={view.warnings} />
    </div>
  )
}

function Warnings({ warnings }: { warnings: string[] }) {
  if (warnings.length === 0) return null
  return (
    <ul className={importStyles.warnings}>
      {warnings.map((warning) => (
        <li key={warning}>{warning}</li>
      ))}
    </ul>
  )
}

function CountTable({ rows, total }: { rows: [string, number][]; total: number }) {
  return (
    <table className={importStyles.counts}>
      <tbody>
        {rows.map(([label, count]) => (
          <tr key={label}>
            <th scope="row">{label}</th>
            <td>{count}</td>
          </tr>
        ))}
        <tr className={importStyles.total}>
          <th scope="row">合計</th>
          <td>{total}</td>
        </tr>
      </tbody>
    </table>
  )
}

function Preview({
  view,
  onExecute,
}: {
  view: Extract<ImportView, { status: 'preview' }>
  onExecute: () => void
}) {
  const { counts } = view.plan
  const writes = counts.new + counts.update
  const examples = view.plan.items.filter((item) => item.action === 'update').slice(0, 3)
  return (
    <div className={styles.panel}>
      <h2>インポート内容</h2>
      <p className={styles.muted}>{view.fileName}</p>
      <CountTable
        rows={[
          ['新規', counts.new],
          ['更新', counts.update],
          ['変更なし', counts.unchanged],
          ['エラー', 0],
        ]}
        total={counts.total}
      />
      {examples.length > 0 && <UpdateExamples examples={examples} />}
      <Warnings warnings={view.warnings} />
      <p className={styles.muted}>学習状態・学習履歴は変わりません（更新するのは問題の内容だけです）。</p>
      <button type="button" className={styles.primaryButton} onClick={onExecute} disabled={writes === 0}>
        {writes === 0 ? '取り込む内容はありません' : 'インポートを実行'}
      </button>
    </div>
  )
}

function UpdateExamples({ examples }: { examples: ImportPlan['items'] }) {
  return (
    <div>
      <p>更新される問題の例：</p>
      <ul className={importStyles.issues}>
        {examples.map((item) => (
          <li key={item.card.id}>
            {item.card.id}（{item.changedFields.map((field) => FIELD_LABELS[field] ?? field).join('・')}）
          </li>
        ))}
      </ul>
    </div>
  )
}

function Finished({
  result,
  rebuilding,
  onRebuild,
  onAgain,
}: {
  result: ImportResult
  rebuilding: boolean
  onRebuild: () => void
  onAgain: () => void
}) {
  const partial = result.error !== null
  return (
    <div className={styles.panel}>
      <h2>{partial ? 'インポートが途中で止まりました' : 'インポート完了'}</h2>
      <CountTable
        rows={[
          ['新規', result.new],
          ['更新', result.update],
          ['変更なし', result.unchanged],
          ['失敗', result.failed],
        ]}
        total={result.total}
      />
      {partial && (
        <p role="alert">
          {result.error} {result.new + result.update > 0 ? '途中まで保存されました。' : ''}
          同じファイルをもう一度取り込むことで続行できます（保存済みの問題は「変更なし」になります）。
        </p>
      )}
      {!partial && result.progressError && (
        <div role="alert">
          <p>カードの取り込みは完了しましたが、集計の再作成に失敗しました。（{result.progressError}）</p>
          <button type="button" className={styles.primaryButton} onClick={onRebuild} disabled={rebuilding}>
            {rebuilding ? '集計を作り直しています…' : '集計を作り直す'}
          </button>
        </div>
      )}
      {!partial && !result.progressError && result.progressRebuilt && result.new + result.update > 0 && (
        <p className={styles.muted}>集計も作り直しました。</p>
      )}
      <button type="button" onClick={onAgain}>
        別のファイルを取り込む
      </button>
    </div>
  )
}
