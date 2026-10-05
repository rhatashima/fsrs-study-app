import js from '@eslint/js'
import { defineConfig, globalIgnores } from 'eslint/config'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import globals from 'globals'
import tseslint from 'typescript-eslint'

/*
 * レイヤー間の import 制限（docs/ARCHITECTURE.md「依存方向のルール」）
 *   - src/domain/ は純粋な TypeScript のみ（外部パッケージ・他のレイヤーを import しない）
 *   - ts-fsrs は src/lib/fsrs/ からのみ import できる
 *   - Firebase SDK は src/services/firebase/ と src/repositories/firestore/ からのみ import できる
 *   - Firebase を使う自前のモジュール（src/services/firebase/）を組み立てるのは src/main.tsx だけ
 *   - domain / lib / services / repositories は React に依存しない
 * 対象パッケージが未インストールでも、import 文の記述だけで検出される。
 * 1 つのファイルには下の layerRules のうち最初に一致した 1 つだけを適用する。
 */
// パッケージ名だけに一致させる（相対パス ./services/firebase/... などには一致させない）
const restrictTsFsrs = {
  regex: '^ts-fsrs(/|$)',
  message: 'ts-fsrs は src/lib/fsrs/ からのみ import してください（ARCHITECTURE.md 参照）。',
}
const restrictFirebase = {
  regex: '^@?firebase(/|$)',
  message:
    'Firebase SDK は src/services/firebase/ と src/repositories/firestore/ からのみ import してください（ARCHITECTURE.md 参照）。',
}
const restrictFsrsInternals = {
  // src/lib/fsrs/ の外からは公開 API（src/lib/fsrs/index.ts）だけを使う
  group: ['**/lib/fsrs/*'],
  message: 'src/lib/fsrs/ の内部ファイルではなく、公開 API（lib/fsrs）を import してください。',
}
const restrictFirebaseLayer = {
  // 画面などは Firebase を直接知らない（AuthGateway / Repository の interface を使う）
  // .../services/firebase/... と、src/services/ 内からの ../firebase/...
  regex: '(^|/)services/firebase(/|$)|^\\.\\./firebase(/|$)',
  message: 'src/services/firebase/ は src/main.tsx（アプリの組み立て）からのみ import してください（ARCHITECTURE.md 参照）。',
}
const restrictReact = {
  group: ['react', 'react/*', 'react-dom', 'react-dom/*', 'react-router', 'react-router/*'],
  message: 'このレイヤーは React に依存させないでください（ARCHITECTURE.md 参照）。',
}
const restrictDomainOutside = {
  // domain 内の相対 import（./x）だけを許可し、外部パッケージと domain の外は禁止
  regex: '^(?!\\./)',
  message: 'src/domain/ は同じディレクトリ内のファイル以外を import しないでください（ARCHITECTURE.md 参照）。',
}

const layerRules = [
  { files: ['src/domain/**'], forbid: [restrictDomainOutside] },
  { files: ['src/lib/fsrs/**'], forbid: [restrictFirebase, restrictReact] },
  {
    files: ['src/services/firebase/**', 'src/repositories/firestore/**'],
    forbid: [restrictTsFsrs, restrictFsrsInternals, restrictReact],
  },
  {
    files: ['src/lib/**', 'src/services/**', 'src/repositories/**'],
    forbid: [restrictTsFsrs, restrictFsrsInternals, restrictFirebase, restrictFirebaseLayer, restrictReact],
  },
  { files: ['src/main.tsx'], forbid: [restrictTsFsrs, restrictFsrsInternals, restrictFirebase] },
  {
    files: ['src/**', 'tests/**'],
    forbid: [restrictTsFsrs, restrictFsrsInternals, restrictFirebase, restrictFirebaseLayer],
  },
]

/** 各ファイルに layerRules の最初に一致した制限だけが適用されるよう、前の層のパスを除外する */
const layerConfigs = layerRules.map((layer, index) => ({
  files: layer.files.map((pattern) =>
    pattern.endsWith('/**') ? `${pattern.slice(0, -3)}/**/*.{ts,tsx}` : pattern,
  ),
  ignores: layerRules.slice(0, index).flatMap((previous) => previous.files),
  rules: { 'no-restricted-imports': ['error', { patterns: layer.forbid }] },
}))

export default defineConfig([
  globalIgnores(['dist', 'coverage', 'node_modules']),

  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommendedTypeChecked,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      ecmaVersion: 2023,
      globals: globals.browser,
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },

  {
    files: ['**/*.js'],
    extends: [js.configs.recommended],
    languageOptions: { globals: globals.node },
  },

  ...layerConfigs,
  // domain のテストは vitest とテスト用ヘルパーを import してよい（React・ts-fsrs・Firebase は禁止のまま）
  {
    files: ['src/domain/**/*.test.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        { patterns: [restrictTsFsrs, restrictFirebase, restrictReact] },
      ],
    },
  },
])
