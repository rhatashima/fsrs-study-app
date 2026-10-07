// @vitest-environment node
import { describe, expect, it } from 'vitest'
import castleCsv from '../../../samples/import/castle-3-sample.csv?raw'
import testJson from '../../../samples/import/test-material-sample.json?raw'
import { SAMPLE_CARDS, SAMPLE_CASTLE_MATERIAL_ID, SAMPLE_MATERIALS, SAMPLE_TEST_MATERIAL_ID } from '../../dev/sampleData'
import { rebuildProgress } from '../../domain'
import { createMemoryRepositories } from '../../repositories/memory/createMemoryRepositories'
import type { Repositories } from '../../repositories/types'
import { makeCard, makeMaterial, makeReviewRecord, T0 } from '../../test/factories'
import { executeImport, IMPORT_CHUNK_SIZE, parseImportFile, planImport } from './index'

const BOM = String.fromCharCode(0xfeff)
const NOW = new Date('2026-10-08T10:00:00+09:00')
const HEADER = 'id,question,answer'

const csv = (...lines: string[]) => lines.join('\n')
const parseCsv = (text: string, materialId = 'm1') => parseImportFile('cards.csv', text, materialId)
const parseJson = (value: unknown, materialId = 'm1') =>
  parseImportFile('cards.json', typeof value === 'string' ? value : JSON.stringify(value), materialId)

/** 教材 m1・m2 と、m1 のカード 3 枚（order 1〜3）と学習記録 */
async function setup() {
  const repos = createMemoryRepositories(
    {
      materials: [makeMaterial({ id: 'm1' }), makeMaterial({ id: 'm2' })],
      cards: [
        makeCard({ id: 'c1', order: 1, category: '石垣', tags: ['a'], examDifficulty: 2 }),
        makeCard({ id: 'c2', order: 2, category: '天守' }),
        makeCard({ id: 'c3', order: 3, category: '天守', isArchived: true }),
      ],
    },
    { clock: () => T0 },
  )
  const record = makeReviewRecord({ cardId: 'c1', logId: 'l1', category: '石垣' })
  await repos.reviews.recordReview(record)
  return { repos, record }
}

/** 元からあるカード（c1〜c3）の学習状態と学習履歴 */
async function snapshotLearning(repos: Repositories, materialId = 'm1') {
  const ids = ['c1', 'c2', 'c3']
  return {
    states: await repos.reviews.listAllStates(materialId),
    logs: await Promise.all(ids.map((id) => repos.reviews.listLogsForCard(materialId, id, { limit: 100 }))),
  }
}

async function importText(repos: Repositories, fileName: string, text: string, materialId = 'm1', chunkSize?: number) {
  const parsed = parseImportFile(fileName, text, materialId)
  expect(parsed.errors).toEqual([])
  const plan = await planImport(repos, materialId, parsed.rows, NOW)
  return { plan, result: await executeImport(repos, plan, { now: NOW, ...(chunkSize ? { chunkSize } : {}) }) }
}

describe('CSV の読み取り', () => {
  it('見出し行・必須列・任意列を読む', () => {
    const parsed = parseCsv(
      csv(
        'id,question,answer,explanation,category,subcategory,tags,examDifficulty,importance,imageUrl,source,notes,order',
        'x1,問題,答え,解説,石垣,積み方,a;b,3,5,/images/x.svg,出典,メモ,7',
      ),
    )
    expect(parsed.errors).toEqual([])
    expect(parsed.totalRows).toBe(1)
    expect(parsed.rows[0]).toMatchObject({
      id: 'x1',
      question: '問題',
      answer: '答え',
      explanation: '解説',
      category: '石垣',
      subcategory: '積み方',
      tags: ['a', 'b'],
      examDifficulty: 3,
      importance: 5,
      imageUrl: '/images/x.svg',
      source: '出典',
      notes: 'メモ',
      order: 7,
    })
  })

  it('UTF-8 の BOM 付きでも読める', () => {
    const parsed = parseCsv(`${BOM}${HEADER}\nx1,問題,答え`)
    expect(parsed.errors).toEqual([])
    expect(parsed.rows[0]?.id).toBe('x1')
  })

  it('カンマ・改行・ダブルクォートを含む項目（引用符で囲んだもの）を正しく読む', () => {
    const parsed = parseCsv(
      csv(`${HEADER},explanation`, 'x1,"A, B, C のうち正しいのは？","""天主"" と書く","1 行目', '2 行目, カンマも"'),
    )
    expect(parsed.errors).toEqual([])
    expect(parsed.rows[0]).toMatchObject({
      question: 'A, B, C のうち正しいのは？',
      answer: '"天主" と書く',
      explanation: '1 行目\n2 行目, カンマも',
    })
  })

  it('tags は ; 区切り。前後の空白・空のタグ・重複を除く', () => {
    const parsed = parseCsv(csv(`${HEADER},tags`, 'x1,Q,A, 石垣 ; 近世城郭;;石垣; 築城技術 '))
    expect(parsed.rows[0]?.tags).toEqual(['石垣', '近世城郭', '築城技術'])
  })

  it('互換用の difficulty 列は examDifficulty として読む（Card に difficulty は作らない）', () => {
    const parsed = parseCsv(csv(`${HEADER},difficulty`, 'x1,Q,A,4'))
    expect(parsed.rows[0]?.examDifficulty).toBe(4)
    expect(parsed.rows[0]).not.toHaveProperty('difficulty')
  })

  it('examDifficulty と difficulty の両方の列があるとエラー', () => {
    const parsed = parseCsv(csv(`${HEADER},examDifficulty,difficulty`, 'x1,Q,A,1,2'))
    expect(parsed.errors.map((e) => e.message).join()).toContain('両方があります')
  })

  it('空行は無視し、未対応の列は警告して無視する', () => {
    const parsed = parseCsv(csv(`${HEADER},memo2`, 'x1,Q,A,z', '', 'x2,Q,A,z', ''))
    expect(parsed.errors).toEqual([])
    expect(parsed.totalRows).toBe(2)
    expect(parsed.warnings.join()).toContain('memo2')
  })

  it('サンプルの CSV（日本城郭検定3級）を読める', () => {
    const parsed = parseImportFile('castle-3-sample.csv', castleCsv, SAMPLE_CASTLE_MATERIAL_ID)
    expect(parsed.errors).toEqual([])
    expect(parsed.format).toBe('csv')
    expect(parsed.totalRows).toBe(14)
    const row = parsed.rows.find((r) => r.id === 'castle-102')
    expect(row?.explanation).toBe('1 行目の解説。\n2 行目の解説（改行の確認用）。')
    expect(row?.tags).toEqual(['石垣', '積み方'])
  })
})

describe('JSON の読み取り', () => {
  it('カードの配列を読む（tags は配列・; 区切りのどちらでも可）', () => {
    const parsed = parseJson([
      { id: 'x1', question: 'Q', answer: 'A', tags: ['a', ' b ', 'a'], examDifficulty: 2, importance: 5 },
      { id: 'x2', question: 'Q', answer: 'A', tags: 'c;d' },
    ])
    expect(parsed.errors).toEqual([])
    expect(parsed.rows.map((r) => r.tags)).toEqual([['a', 'b'], ['c', 'd']])
    expect(parsed.rows[0]).toMatchObject({ examDifficulty: 2, importance: 5 })
  })

  it('{ "cards": [...] } の形も読める', () => {
    expect(parseJson({ cards: [{ id: 'x1', question: 'Q', answer: 'A' }] }).rows).toHaveLength(1)
  })

  it('互換用の difficulty は examDifficulty として読む。両方あるとエラー', () => {
    expect(parseJson([{ id: 'x1', question: 'Q', answer: 'A', difficulty: 2 }]).rows[0]?.examDifficulty).toBe(2)
    const both = parseJson([{ id: 'x1', question: 'Q', answer: 'A', difficulty: 2, examDifficulty: 3 }])
    expect(both.errors[0]).toMatchObject({ where: '1 件目' })
  })

  it('JSON として壊れているとエラー（日本語）', () => {
    const parsed = parseJson('[{ "id": "x1", ')
    expect(parsed.errors).toHaveLength(1)
    expect(parsed.errors[0]).toMatchObject({ where: 'ファイル全体' })
    expect(parsed.errors[0]?.message).toContain('JSON として読み取れません')
  })

  it.each([
    ['オブジェクト', '{ "id": "x1" }'],
    ['文字列', '"not cards"'],
    ['数値', '3'],
  ])('配列でない（%s）とエラー', (_label, text) => {
    expect(parseJson(text).errors[0]?.message).toContain('配列')
  })

  it('配列の中にオブジェクトでないものがあるとエラー', () => {
    const parsed = parseJson([{ id: 'x1', question: 'Q', answer: 'A' }, 'x', null])
    expect(parsed.errors.map((e) => e.where)).toEqual(['2 件目', '3 件目'])
  })

  it('サンプルの JSON（テスト用教材）を読める', () => {
    const parsed = parseImportFile('test-material-sample.json', testJson, SAMPLE_TEST_MATERIAL_ID)
    expect(parsed.errors).toEqual([])
    expect(parsed.totalRows).toBe(10)
  })
})

describe('検証（何行目の何が問題か）', () => {
  it.each([
    ['id が空', 'x,Q,A'.replace('x', ''), 'id が空'],
    ['問題が空', 'x1,,A', '問題（question）が空'],
    ['答えが空', 'x1,Q,', '答え（answer）が空'],
    ['id に使えない文字', 'x/1,Q,A', 'id「x/1」は使えません'],
  ])('%s', (_label, line, message) => {
    const parsed = parseCsv(csv(HEADER, 'ok,Q,A', line))
    expect(parsed.errors).toEqual([{ where: '3 行目', message: expect.stringContaining(message) as string }])
  })

  it('必須の列がないとエラー', () => {
    const parsed = parseCsv(csv('id,question', 'x1,Q'))
    expect(parsed.errors).toEqual([{ where: 'ファイル全体', message: '必須の列「answer」がありません。' }, expect.anything()])
  })

  it('ファイル内で id が重複しているとエラー（両方の位置を示す）', () => {
    const parsed = parseCsv(csv(HEADER, 'x1,Q,A', 'x2,Q,A', 'x1,Q2,A2'))
    expect(parsed.errors).toEqual([{ where: '4 行目', message: 'id「x1」が 2 行目 と重複しています。' }])
  })

  it('ほかの項目にエラーがある行も含めて、id の重複を見つける', () => {
    const parsed = parseCsv(csv(HEADER, 'x1,Q,', 'x1,Q,A'))
    expect(parsed.errors.map((e) => `${e.where}:${e.message}`)).toEqual([
      '2 行目:答え（answer）が空です。',
      '3 行目:id「x1」が 2 行目 と重複しています。',
    ])
  })

  it.each([
    ['0', '問題の難易度'],
    ['6', '問題の難易度'],
    ['2.5', '問題の難易度'],
    ['abc', '問題の難易度'],
  ])('問題の難易度 %s は 1〜5 の整数でないのでエラー', (value, message) => {
    expect(parseCsv(csv(`${HEADER},examDifficulty`, `x1,Q,A,${value}`)).errors[0]?.message).toContain(message)
  })

  it.each(['0', '6', '-1', 'x'])('重要度 %s はエラー', (value) => {
    expect(parseCsv(csv(`${HEADER},importance`, `x1,Q,A,${value}`)).errors[0]?.message).toContain('重要度')
  })

  it.each(['0', '-3', '1.5', 'abc', '99999999999'])('並び順 %s はエラー', (value) => {
    expect(parseCsv(csv(`${HEADER},order`, `x1,Q,A,${value}`)).errors[0]?.message).toContain('並び順')
  })

  it('materialId：選んだ教材と同じなら可、違えばエラー', () => {
    expect(parseCsv(csv(`${HEADER},materialId`, 'x1,Q,A,m1'), 'm1').errors).toEqual([])
    expect(parseCsv(csv(`${HEADER},materialId`, 'x1,Q,A,m2'), 'm1').errors[0]?.message).toContain('選んだ教材と違います')
  })

  it('画像は https:// か / で始まるものだけ', () => {
    expect(parseCsv(csv(`${HEADER},imageUrl`, 'x1,Q,A,http://example.com/a.png')).errors[0]?.message).toContain('画像')
  })

  it('CSV として壊れている（引用符が閉じていない・列数が違う）とエラー', () => {
    expect(parseCsv(csv(HEADER, 'x1,"Q,A')).errors.map((e) => e.message).join()).toContain('ダブルクォート')
    expect(parseCsv(csv(HEADER, 'x1,Q,A,extra')).errors[0]).toEqual({ where: '2 行目', message: '列の数が見出し行（3 列）と違います。' })
  })

  it('エラーが 1 件でもあれば、保存できる行があっても取り込みの対象外として扱える', () => {
    const parsed = parseCsv(csv(HEADER, 'x1,Q,A', 'x2,,A'))
    expect(parsed.errors).toHaveLength(1)
    expect(parsed.rows.map((r) => r.id)).toEqual(['x1'])
  })
})

describe('既存カードとの比較（新規・更新・変更なし）', () => {
  it('新規・更新・変更なしに分ける', async () => {
    const { repos } = await setup()
    const parsed = parseCsv(
      csv(
        `${HEADER},category,tags,examDifficulty`,
        'c1,問題 c1,答え c1,石垣,a,2', // 変更なし
        'c2,修正した問題,答え c2,天守,,', // 更新（問題文）
        'n1,新しい問題,新しい答え,城郭史,x;y,3', // 新規
      ),
    )
    const plan = await planImport(repos, 'm1', parsed.rows, NOW)
    expect(plan.counts).toEqual({ new: 1, update: 1, unchanged: 1, total: 3 })
    expect(plan.items.map((i) => [i.card.id, i.action])).toEqual([
      ['c1', 'unchanged'],
      ['c2', 'update'],
      ['n1', 'new'],
    ])
    expect(plan.items[1]?.changedFields).toEqual(['question'])
  })

  it('新規カード：order がなければ最大値の後ろにファイルの順で、指定があればその値。日時は取り込み時刻', async () => {
    const { repos } = await setup()
    const parsed = parseCsv(csv(`${HEADER},order`, 'n1,Q,A,', 'n2,Q,A,10', 'n3,Q,A,'))
    const plan = await planImport(repos, 'm1', parsed.rows, NOW)
    expect(plan.items.map((i) => [i.card.id, i.card.order])).toEqual([
      ['n1', 11],
      ['n2', 10],
      ['n3', 12],
    ])
    expect(plan.items[0]?.card).toMatchObject({ createdAt: NOW, updatedAt: NOW, isArchived: false, materialId: 'm1' })
  })

  it('既存カード：並び順・作成日時・アーカイブの状態は変えず、更新日時だけ変える', async () => {
    const { repos } = await setup()
    const parsed = parseCsv(csv(HEADER, 'c3,新しい問題,答え c3'))
    const [item] = (await planImport(repos, 'm1', parsed.rows, NOW)).items
    expect(item?.action).toBe('update')
    expect(item?.card).toMatchObject({ order: 3, isArchived: true, createdAt: T0, updatedAt: NOW })
  })

  it('ファイルにない列の値は残し、空の列は値を消す', async () => {
    const { repos } = await setup()
    // examDifficulty の列なし → 2 のまま。tags の列が空 → 空にする
    const parsed = parseCsv(csv(`${HEADER},tags`, 'c1,問題 c1,答え c1,'))
    const [item] = (await planImport(repos, 'm1', parsed.rows, NOW)).items
    expect(item?.card).toMatchObject({ examDifficulty: 2, tags: [] })
    expect(item?.changedFields).toEqual(['tags'])
  })

  it('変更なしのカードは保存しない（更新日時も変えない）', async () => {
    const { repos } = await setup()
    const { result } = await importText(repos, 'a.csv', csv(HEADER, 'c1,問題 c1,答え c1'))
    expect(result).toMatchObject({ new: 0, update: 0, unchanged: 1, failed: 0 })
    expect((await repos.cards.getByIds('m1', ['c1']))[0]?.updatedAt).toEqual(T0)
  })
})

describe('保存', () => {
  it('学習済みのカードを更新しても、学習状態・学習履歴は変わらない', async () => {
    const { repos, record } = await setup()
    const before = await snapshotLearning(repos)
    const { result } = await importText(repos, 'a.csv', csv(`${HEADER},category`, 'c1,修正した問題,修正した答え,城郭史'))
    expect(result.update).toBe(1)
    expect((await repos.cards.getByIds('m1', ['c1']))[0]?.question).toBe('修正した問題')
    expect(await snapshotLearning(repos)).toEqual(before)
    expect((await repos.reviews.getStates('m1', ['c1']))[0]).toEqual(record.state)
  })

  it('ファイルにない既存カードは削除しない', async () => {
    const { repos } = await setup()
    await importText(repos, 'a.csv', csv(HEADER, 'n1,Q,A'))
    expect((await repos.cards.listAll('m1')).map((c) => c.id).sort()).toEqual(['c1', 'c2', 'c3', 'n1'])
  })

  it(`カードは ${IMPORT_CHUNK_SIZE} 件ずつ順番に保存する（1000 件）`, async () => {
    const { repos } = await setup()
    const sizes: number[] = []
    const saveMany = repos.cards.saveMany.bind(repos.cards)
    repos.cards.saveMany = (cards) => {
      sizes.push(cards.length)
      return saveMany(cards)
    }
    const progress: [number, number][] = []
    const parsed = parseCsv(csv(HEADER, ...Array.from({ length: 1000 }, (_, i) => `n${i},問題 ${i},答え ${i}`)))
    const plan = await planImport(repos, 'm1', parsed.rows, NOW)
    const result = await executeImport(repos, plan, { now: NOW, onProgress: (done, total) => progress.push([done, total]) })

    expect(sizes).toEqual([400, 400, 200])
    expect(progress).toEqual([
      [0, 1000],
      [400, 1000],
      [800, 1000],
      [1000, 1000],
    ])
    expect(result).toMatchObject({ new: 1000, update: 0, unchanged: 0, failed: 0, total: 1000, error: null, progressRebuilt: true })
    expect(await repos.cards.countActive('m1')).toBe(1002)
    expect((await repos.reviews.getProgress('m1')).totalCards).toBe(1002)
  })

  it('途中で失敗しても保存済みの分は残り、同じファイルをもう一度取り込むと残りだけを保存する（重複しない）', async () => {
    const { repos } = await setup()
    const learningBefore = await snapshotLearning(repos)
    const text = csv(
      `${HEADER},category`,
      'c1,修正した問題,答え c1,石垣', // 更新
      ...Array.from({ length: 999 }, (_, i) => `n${i},問題 ${i},答え ${i},天守`), // 新規 999
    )
    const saveMany = repos.cards.saveMany.bind(repos.cards)
    let calls = 0
    repos.cards.saveMany = (cards) => {
      calls += 1
      return calls === 3 ? Promise.reject(new Error('network')) : saveMany(cards)
    }
    const first = await importText(repos, 'a.csv', text)
    expect(first.result).toMatchObject({ new: 799, update: 1, failed: 200, unchanged: 0, total: 1000, progressRebuilt: false })
    expect(first.result.error).toBeTruthy()
    expect(await repos.cards.countActive('m1')).toBe(2 + 799)

    // もう一度（今度は成功）
    const second = await importText(repos, 'a.csv', text)
    expect(second.plan.counts).toEqual({ new: 200, update: 0, unchanged: 800, total: 1000 })
    expect(second.result).toMatchObject({ new: 200, update: 0, unchanged: 800, failed: 0, progressRebuilt: true })

    const all = await repos.cards.listAll('m1')
    expect(all).toHaveLength(3 + 999)
    expect(new Set(all.map((c) => c.id)).size).toBe(all.length)
    expect(new Set(all.map((c) => c.order)).size).toBe(all.length)
    expect(await snapshotLearning(repos)).toEqual(learningBefore)

    // 3 回目：すべて変更なし
    const third = await importText(repos, 'a.csv', text)
    expect(third.plan.counts).toMatchObject({ new: 0, update: 0, unchanged: 1000 })
  })
})

describe('集計（MaterialProgress）の作り直し', () => {
  it('取り込み後に全件から作り直す（新規カード・学習済みカードのカテゴリー変更も反映）', async () => {
    const { repos } = await setup()
    await importText(repos, 'a.csv', csv(`${HEADER},category`, 'c1,問題 c1,答え c1,城郭史', 'n1,Q,A,城郭史'))
    const progress = await repos.reviews.getProgress('m1')
    const expected = rebuildProgress({
      materialId: 'm1',
      cards: await repos.cards.listAll('m1'),
      states: await repos.reviews.listAllStates('m1'),
      now: NOW,
    })
    expect(progress).toMatchObject({ totalCards: 3, studiedCards: 1, byCategory: expected.byCategory })
    expect(progress.byCategory['城郭史']).toMatchObject({ totalCards: 2, studiedCards: 1 })
    expect(progress.byCategory['石垣']).toBeUndefined()
    // 日別の記録は引き継ぐ
    expect(progress.daily['2026-10-01']).toEqual({ reviews: 1, newCards: 1 })
  })

  it('カードの保存は成功し、集計の作り直しだけ失敗した場合は、その旨を返す（カードは戻さない）', async () => {
    const { repos } = await setup()
    repos.reviews.replaceProgress = () => Promise.reject(new Error('network'))
    const { result } = await importText(repos, 'a.csv', csv(HEADER, 'n1,Q,A'))
    expect(result).toMatchObject({ new: 1, failed: 0, error: null, progressRebuilt: false })
    expect(result.progressError).toBeTruthy()
    expect(await repos.cards.getByIds('m1', ['n1'])).toHaveLength(1)
  })
})

describe('サンプルファイルを開発用データに取り込む', () => {
  it('CSV：日本城郭検定3級（更新 1・変更なし 1・新規 12）', async () => {
    const repos = createMemoryRepositories({ materials: SAMPLE_MATERIALS, cards: SAMPLE_CARDS }, { clock: () => T0 })
    const { plan, result } = await importText(repos, 'castle-3-sample.csv', castleCsv, SAMPLE_CASTLE_MATERIAL_ID)
    expect(plan.counts).toEqual({ new: 12, update: 1, unchanged: 1, total: 14 })
    expect(result).toMatchObject({ new: 12, update: 1, unchanged: 1, failed: 0, progressRebuilt: true })
    const [created] = await repos.cards.getByIds(SAMPLE_CASTLE_MATERIAL_ID, ['castle-103'])
    expect(created).toMatchObject({ question: '［サンプル］"天守" の別名を答えよ', examDifficulty: 2 })
    expect(created).not.toHaveProperty('difficulty')
    const [ordered] = await repos.cards.getByIds(SAMPLE_CASTLE_MATERIAL_ID, ['castle-105'])
    expect(ordered?.order).toBe(200)
  })

  it('JSON：テスト用教材（更新 1・変更なし 1・新規 8）', async () => {
    const repos = createMemoryRepositories({ materials: SAMPLE_MATERIALS, cards: SAMPLE_CARDS }, { clock: () => T0 })
    const { plan } = await importText(repos, 'test-material-sample.json', testJson, SAMPLE_TEST_MATERIAL_ID)
    expect(plan.counts).toEqual({ new: 8, update: 1, unchanged: 1, total: 10 })
    expect(plan.items.find((i) => i.card.id === 'test-002')?.changedFields).toEqual(['importance'])
    const [alias] = await repos.cards.getByIds(SAMPLE_TEST_MATERIAL_ID, ['test-102'])
    expect(alias).toMatchObject({ examDifficulty: 3, tags: ['互換', 'difficulty'] })
  })

  it('別の教材を選んで JSON（materialId 付き）を取り込もうとするとエラー', () => {
    const parsed = parseImportFile('test-material-sample.json', testJson, SAMPLE_CASTLE_MATERIAL_ID)
    expect(parsed.errors.map((e) => e.where)).toEqual(['7 件目'])
  })
})

// 型だけで Card に difficulty がないことは保証されているが、取り込み結果の実データも確認する
it('取り込んだカードに difficulty という項目はない', async () => {
  const { repos } = await setup()
  await importText(repos, 'a.json', JSON.stringify([{ id: 'n1', question: 'Q', answer: 'A', difficulty: 4 }]))
  const [card] = await repos.cards.getByIds('m1', ['n1'])
  expect(card).toMatchObject({ examDifficulty: 4 })
  expect(Object.keys(card ?? {})).not.toContain('difficulty')
})
