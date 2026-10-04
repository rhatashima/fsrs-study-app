// @vitest-environment node
import { ESLint } from 'eslint'
import { describe, expect, it } from 'vitest'

/**
 * eslint.config.js の import 制限（docs/ARCHITECTURE.md「依存方向のルール」）が
 * 意図どおりに働くことを確認する。ファイルは実在しなくてよい（パスでルールが決まる）。
 */
const eslint = new ESLint({
  // 型情報を使うルールは仮想ファイルに適用できないため、このテストでは import 制限だけを見る
  overrideConfig: { languageOptions: { parserOptions: { projectService: false } } },
  ruleFilter: ({ ruleId }) => ruleId === 'no-restricted-imports',
})

async function restrictedImportErrors(filePath: string, code: string) {
  const [result] = await eslint.lintText(code, { filePath })
  return (result?.messages ?? []).filter((m) => m.ruleId === 'no-restricted-imports')
}

const TS_FSRS = "import { fsrs } from 'ts-fsrs'\nexport const s = fsrs()\n"
const FIREBASE = "import { getFirestore } from 'firebase/firestore'\nexport const db = getFirestore()\n"

describe('import boundaries', () => {
  it.each([
    ['src/pages/StudyPage.tsx'],
    ['src/components/Example.tsx'],
    ['src/services/studyQueue.ts'],
    ['src/repositories/firestore/cards.ts'],
  ])('%s から ts-fsrs を import できない', async (file) => {
    expect(await restrictedImportErrors(file, TS_FSRS)).toHaveLength(1)
  })

  it.each([
    ['src/pages/StudyPage.tsx'],
    ['src/services/reviewService.ts'],
    ['src/lib/fsrs/scheduler.ts'],
  ])('%s から Firebase SDK を import できない', async (file) => {
    expect(await restrictedImportErrors(file, FIREBASE)).toHaveLength(1)
  })

  it('src/lib/fsrs/ からは ts-fsrs を import できる', async () => {
    expect(await restrictedImportErrors('src/lib/fsrs/scheduler.ts', TS_FSRS)).toHaveLength(0)
  })

  it.each([['src/services/firebase/app.ts'], ['src/repositories/firestore/cards.ts']])(
    '%s からは Firebase SDK を import できる',
    async (file) => {
      expect(await restrictedImportErrors(file, FIREBASE)).toHaveLength(0)
    },
  )

  it('@firebase/* のサブパッケージも制限される', async () => {
    const code = "import { initializeApp } from '@firebase/app'\nexport const app = initializeApp({})\n"
    expect(await restrictedImportErrors('src/pages/HomePage.tsx', code)).toHaveLength(1)
  })
})
