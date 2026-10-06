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

  describe('src/domain/ は純粋な TypeScript のみ', () => {
    it.each([
      ["import { useState } from 'react'"],
      ["import { Link } from 'react-router'"],
      ["import { fsrs } from 'ts-fsrs'"],
      ["import { getFirestore } from 'firebase/firestore'"],
      ["import type { Repositories } from '../repositories/types'"],
      ["import { x } from '../lib/fsrs/scheduler'"],
    ])('%s は禁止', async (statement) => {
      expect(await restrictedImportErrors('src/domain/card.ts', `${statement}\n`)).toHaveLength(1)
    })

    it('domain 内の相対 import は許可', async () => {
      const code = "import type { Card } from './card'\nexport type X = Card\n"
      expect(await restrictedImportErrors('src/domain/selection.ts', code)).toHaveLength(0)
    })

    it('domain のテストは vitest とテスト用ヘルパーを使えるが、React は禁止のまま', async () => {
      const ok = "import { it } from 'vitest'\nimport { makeCard } from '../test/factories'\n"
      expect(await restrictedImportErrors('src/domain/card.test.ts', ok)).toHaveLength(0)
      const ng = "import { useState } from 'react'\n"
      expect(await restrictedImportErrors('src/domain/card.test.ts', ng)).toHaveLength(1)
    })
  })

  it.each([
    ['src/services/studyQueue.ts'],
    ['src/repositories/memory/createMemoryRepositories.ts'],
    ['src/lib/fsrs/scheduler.ts'],
  ])('%s から React を import できない', async (file) => {
    const code = "import { useState } from 'react'\nexport const s = useState\n"
    expect(await restrictedImportErrors(file, code)).toHaveLength(1)
  })

  it('画面（pages）からは React と domain を import できる', async () => {
    const code =
      "import { useState } from 'react'\nimport { isDue } from '../domain'\nexport const s = [useState, isDue]\n"
    expect(await restrictedImportErrors('src/pages/HomePage.tsx', code)).toHaveLength(0)
  })

  describe('src/lib/fsrs/ の外からは公開 API（index）だけを使う', () => {
    it.each([['src/services/studyService.ts'], ['src/hooks/useStudySession.ts'], ['src/pages/StudyPage.tsx']])(
      '%s から lib/fsrs は import できるが、内部ファイル（adapter）は import できない',
      async (file) => {
        const depth = file.split('/').length - 2
        const prefix = '../'.repeat(depth)
        const ok = `import { createFsrsScheduler } from '${prefix}lib/fsrs'\n`
        const ng = `import { toFsrsCard } from '${prefix}lib/fsrs/adapter'\n`
        expect(await restrictedImportErrors(file, ok)).toHaveLength(0)
        expect(await restrictedImportErrors(file, ng)).toHaveLength(1)
      },
    )

    it('src/lib/fsrs/ の中では内部ファイルを import できる', async () => {
      const code = "import { toFsrsCard } from './adapter'\n"
      expect(await restrictedImportErrors('src/lib/fsrs/scheduler.ts', code)).toHaveLength(0)
    })
  })

  describe('Firebase を使う自前のモジュール（src/services/firebase/）', () => {
    const code = "import { createFirebaseAuthGateway } from './services/firebase/auth'\n"

    it('src/main.tsx（アプリの組み立て）からは import できる', async () => {
      expect(await restrictedImportErrors('src/main.tsx', code)).toHaveLength(0)
    })

    it('src/main.tsx からは Firestore 版リポジトリも import できる', async () => {
      const firestoreRepo =
        "import { createFirestoreRepositories } from './repositories/firestore/createFirestoreRepositories'\n"
      expect(await restrictedImportErrors('src/main.tsx', firestoreRepo)).toHaveLength(0)
    })

    it.each([
      ['src/pages/StudyPage.tsx', "import { createFirestoreRepositories } from '../repositories/firestore/createFirestoreRepositories'\n"],
      ['src/repositories/memory/createMemoryRepositories.ts', "import { parseCard } from '../firestore/validation'\n"],
      ['src/pages/LoginPage.tsx', "import { toAppUser } from '../services/firebase/auth'\n"],
      ['src/app/AuthProvider.tsx', "import { getFirebaseApp } from '../services/firebase/app'\n"],
      ['src/services/auth/signInMethod.ts', "import { toAuthAppError } from '../firebase/authErrors'\n"],
    ])('%s からは import できない（interface 経由で使う）', async (file, statement) => {
      expect(await restrictedImportErrors(file, statement)).toHaveLength(1)
    })

    it('Firebase SDK はパッケージ名だけで判定する（自前の services/firebase/ への相対パスは SDK 扱いしない）', async () => {
      const errors = await restrictedImportErrors('src/main.tsx', `${code}import { getAuth } from 'firebase/auth'\n`)
      expect(errors).toHaveLength(1)
      expect(errors[0]?.message).toContain('Firebase SDK')
    })
  })

  it('@firebase/* のサブパッケージも制限される', async () => {
    const code = "import { initializeApp } from '@firebase/app'\nexport const app = initializeApp({})\n"
    expect(await restrictedImportErrors('src/pages/HomePage.tsx', code)).toHaveLength(1)
  })
})
