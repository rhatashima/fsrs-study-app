import js from '@eslint/js'
import { defineConfig, globalIgnores } from 'eslint/config'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import globals from 'globals'
import tseslint from 'typescript-eslint'

/*
 * レイヤー間の import 制限（docs/ARCHITECTURE.md「依存方向のルール」）
 *   - ts-fsrs は src/lib/fsrs/ からのみ import できる
 *   - Firebase SDK は src/services/firebase/ と src/repositories/firestore/ からのみ import できる
 * 対象パッケージが未インストールでも、import 文の記述だけで検出される。
 */
const restrictTsFsrs = {
  group: ['ts-fsrs', 'ts-fsrs/*'],
  message: 'ts-fsrs は src/lib/fsrs/ からのみ import してください（ARCHITECTURE.md 参照）。',
}
const restrictFirebase = {
  group: ['firebase', 'firebase/*', '@firebase/*'],
  message:
    'Firebase SDK は src/services/firebase/ と src/repositories/firestore/ からのみ import してください（ARCHITECTURE.md 参照）。',
}
const restrictImports = (...patterns) => ['error', { patterns }]

const FSRS_DIRS = ['src/lib/fsrs/**']
const FIREBASE_DIRS = ['src/services/firebase/**', 'src/repositories/firestore/**']

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

  // import 制限：既定ではどちらも禁止
  {
    files: ['src/**/*.{ts,tsx}', 'tests/**/*.ts'],
    ignores: [...FSRS_DIRS, ...FIREBASE_DIRS],
    rules: { 'no-restricted-imports': restrictImports(restrictTsFsrs, restrictFirebase) },
  },
  // src/lib/fsrs/ は ts-fsrs のみ許可
  {
    files: FSRS_DIRS,
    rules: { 'no-restricted-imports': restrictImports(restrictFirebase) },
  },
  // Firebase 層は Firebase SDK のみ許可
  {
    files: FIREBASE_DIRS,
    rules: { 'no-restricted-imports': restrictImports(restrictTsFsrs) },
  },
])
