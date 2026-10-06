// .env.local から、デプロイに必要な次のファイルを生成する（どちらも Git に入れない）。
//   - firestore.rules：firestore.rules.template の __OWNER_UID__ を VITE_OWNER_UID で置き換えたもの
//   - .firebaserc：VITE_FIREBASE_PROJECT_ID を既定のプロジェクトにしたもの
// 値は画面に表示しない（変数名だけを表示する）。
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const PLACEHOLDER = '__OWNER_UID__'

function readEnvFile(path) {
  if (!existsSync(path)) return {}
  const env = {}
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line)
    if (!match) continue
    env[match[1]] = match[2].replace(/^(['"])(.*)\1$/, '$2').trim()
  }
  return env
}

function fail(message) {
  console.error(`firebase:prepare: ${message}`)
  process.exit(1)
}

const env = { ...readEnvFile(`${root}.env.local`), ...process.env }
const ownerUid = env.VITE_OWNER_UID ?? ''
const projectId = env.VITE_FIREBASE_PROJECT_ID ?? ''

// Firebase Authentication の UID は英数字（最大 128 文字）
if (!/^[A-Za-z0-9]{1,128}$/.test(ownerUid)) {
  fail('VITE_OWNER_UID が未設定か、UID の形式ではありません（.env.local を確認してください）。')
}
if (!/^[a-z0-9-]{4,40}$/.test(projectId)) {
  fail('VITE_FIREBASE_PROJECT_ID が未設定か、プロジェクト ID の形式ではありません（.env.local を確認してください）。')
}

const template = readFileSync(`${root}firestore.rules.template`, 'utf8')
if (template.split(PLACEHOLDER).length !== 2) {
  fail(`firestore.rules.template に ${PLACEHOLDER} がちょうど 1 か所必要です。`)
}
const header = '// 生成ファイル：編集しない（firestore.rules.template を編集して npm run firebase:prepare を実行する）\n'
writeFileSync(`${root}firestore.rules`, header + template.replace(PLACEHOLDER, ownerUid))
writeFileSync(`${root}.firebaserc`, `${JSON.stringify({ projects: { default: projectId } }, null, 2)}\n`)

console.log('firebase:prepare: firestore.rules と .firebaserc を生成しました（VITE_OWNER_UID / VITE_FIREBASE_PROJECT_ID を使用）。')
