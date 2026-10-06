# アーキテクチャ (ARCHITECTURE)

最終更新: 2026-10-06 / Phase 5

## 1. 全体像

```
┌──────────────────────────── ブラウザ / PWA ─────────────────────────────┐
│  pages / components (UI, 日本語)                                         │
│        │ hooks 経由でのみ呼ぶ                                            │
│        ▼                                                                 │
│  services/  ← 純粋なアプリロジック（学習キュー・レビュー・統計・インポート）│
│        │                 │                                               │
│        ▼                 ▼                                               │
│  lib/fsrs/          repositories/ (interface)                            │
│  (ts-fsrs を          ├─ memory/    … テスト・ローカル開発用             │
│   import する          └─ firestore/ … 本番                              │
│   唯一の場所)                 │                                          │
│                               ▼                                          │
│                     services/firebase/ (初期化・Auth)                    │
└──────────────────────────────────┬───────────────────────────────────────┘
                                   ▼
                 Firebase Auth / Cloud Firestore (Spark プラン)
                 Security Rules で Owner UID のみ許可
```

### 依存方向のルール（ESLint `no-restricted-imports` で強制する）

| レイヤー | import してよいもの | 禁止 |
|---|---|---|
| `domain/` | 同じディレクトリ内のファイルのみ（型と純粋関数） | 外部パッケージすべて（React, react-router, firebase, ts-fsrs 等）、他のレイヤー |
| `lib/fsrs/` | `ts-fsrs`, `domain/` | React, firebase |
| `services/` | `domain/`, `lib/fsrs/`, `repositories/types` | React, firebase, ts-fsrs 直接 |
| `repositories/firestore/` | `firebase/*`, `domain/` | React, ts-fsrs |
| `hooks/`, `pages/`, `components/` | `services/`, `domain/`, リポジトリはコンテキスト経由 | `firebase/*`, `ts-fsrs` 直接 |

これにより：
- バックエンドを Firestore から別のものに替えても、`repositories/` の実装を差し替えるだけで UI と FSRS ロジックを再利用できる。
- ts-fsrs の API 変更（例：v6 での `elapsed_days` 削除）の影響を `lib/fsrs/` に閉じ込められる。

この制限は ESLint（`eslint.config.js` の `layerRules`）で強制し、制限が働くことを `tests/architecture/import-boundaries.test.ts` で確認している。

### Domain → FSRS Adapter → Repository の責務

| 層 | 場所 | 責務 | 知らないこと |
|---|---|---|---|
| **Domain** | `src/domain/` | データの意味と制約（型）、ライブラリに依存しない判定・集計（未学習判定、期限判定、新規カードの order 順の取り出し、集計の加算・再集計、学習日の計算、FSRS 設定 id の生成） | ts-fsrs、Firebase、React、日時以外の環境 |
| **FSRS Adapter** | `src/lib/fsrs/` | ドメイン型 ↔ ts-fsrs の型の変換（`ReviewRating` ↔ `Rating`、`LearningPhase` ↔ `State`、`SchedulingSnapshot` ↔ ts-fsrs `Card`）、ts-fsrs による次回予定の計算、パラメータの正規化（ts-fsrs の `generatorParameters`）、`SchedulerConfig` の生成 | Firebase、React、保存方法 |
| **Repository** | `src/repositories/`（interface は `types.ts`、実装は `memory/` と `firestore/`） | 保存と取得。「必要な分だけ」のクエリ、レビュー結果（ReviewState・ReviewLog・集計）のアトミックな保存、外部エラーの `AppError` への変換、`Date` ↔ `Timestamp` の変換（Firestore） | ts-fsrs、React、FSRS の計算 |

サービス（`src/services/`、Phase 3〜）がこの 3 つを組み合わせる。例：レビュー時は Repository から状態を取得 → Adapter で次の状態を計算 → Domain の型で ReviewState・ReviewLog を組み立て → Repository の `recordReview` で保存。

### Repository の構成（`src/repositories/types.ts`）

| interface | 主なメソッド | 備考 |
|---|---|---|
| `MaterialRepository` | `list` / `get` / `save` | |
| `CardRepository` | `getByIds` / `listNewCandidates` / `countActive` / `saveMany` | Card だけを扱い、ReviewState / ReviewLog に触れない |
| `ReviewRepository` | `getStates` / `listDue` / `recordReview` / `listLogsForCard` / `findCardsWithLogs` / `restoreState` / `getProgress` / `replaceProgress` | ReviewState・ReviewLog・集計は 1 回のレビューで同時に更新する必要があるため 1 つにまとめた。**ReviewLog を変更・削除するメソッドは持たない**（追記のみ）。`recordReview` は同じ内容の再送に対して冪等 |
| `SettingsRepository` | `getSettings` / `saveSettings` / `getSchedulerConfig` / `saveSchedulerConfig` | SchedulerConfig は作成のみ |

実装は 2 つ。どちらも `src/repositories/repositoryContract.ts` の**同じ契約テスト**で確認する。

| 実装 | 用途 | テスト |
|---|---|---|
| `memory/createMemoryRepositories` | ユニットテスト・画面のテスト（呼び出しごとに独立したデータ。保存・取得のたびにコピー） | `npm test` |
| `firestore/createFirestoreRepositories` | アプリ本体（`users/{uid}/...`） | `npm run test:rules`（Firestore Emulator + 本物の Security Rules） |

保存時の整合性ルール（カードの検査、レビュー保存の判定、復元の検査）は `src/repositories/writeRules.ts` に置き、両方の実装で共通に使う。Firestore 実装は Date ↔ Timestamp の変換（`serialization.ts`）、読み込みデータの検証（`validation.ts`）、エラーの日本語化（`errors.ts`）をこの層で行い、Firestore の型を外に出さない。

## 2. ディレクトリ構成（予定）

```
fsrs-study-app/
├─ CLAUDE.md
├─ README.md
├─ docs/                      設計ドキュメント
├─ .env.example               必要な環境変数のキー名のみ
├─ firebase.json              Hosting / Firestore / Emulator 設定
├─ firebase.emulator.json     Rules テスト用の Emulator 設定
├─ firestore.rules.template   Security Rules（Owner UID はプレースホルダ）
├─ firestore.indexes.json
├─ scripts/
│   └─ firebase-prepare.mjs   .env.local から firestore.rules と .firebaserc を生成（生成物は gitignore）
├─ public/
│   ├─ icons/                 PWA アイコン
│   └─ images/                画像付きカード用（任意）
├─ samples/
│   ├─ castle-3-dummy.csv     ダミー教材（20問）
│   └─ test-material.json
├─ tests/
│   ├─ architecture/          import 制限（レイヤー境界）のテスト
│   └─ rules/                 Security Rules テスト（Emulator 使用、別コマンド）
└─ src/
    ├─ main.tsx
    ├─ app/                   ルーター, レイアウト, データ層と時計の Context（repositoryContext, clockContext）, AuthGate（Phase 4）
    ├─ pages/                 HomePage, StudyPage, MaterialsPage, StatsPage, SettingsPage（ImportPage, LoginPage は後続 Phase）
    ├─ components/            共通 UI（TabBar, StudyCard, CardImage, RatingButtons …）
    ├─ hooks/                 useStudySession（学習画面の状態とアクション）…
    ├─ domain/                型定義と純粋関数（material, card, rating, scheduling, review, progress, selection, studyQueue, date, settings, errors）
    ├─ dev/                   開発用ダミーデータ（sampleData.ts）とそれを読み込んだメモリリポジトリ
    ├─ lib/
    │   ├─ fsrs/              ts-fsrs のアダプター（adapter.ts）とスケジューラー（scheduler.ts）。外からは index.ts だけを使う
    │   ├─ formatInterval.ts  次回予定の日本語表示（「10分」「4日」など）
    │   ├─ id.ts              ランダム id
    │   └─ errorMessage.ts    エラー → 日本語メッセージ
    ├─ services/
    │   ├─ reviewService.ts   評価 → 新 ReviewState + ReviewLog + 集計用情報（保存はしない）
    │   ├─ studyService.ts    学習セッションの開始・評価の確定・ホームの件数（リポジトリ・FSRS・ドメインの組み合わせ）
    │   ├─ statsService.ts    統計集計（Phase 8）
    │   ├─ import/            CSV/JSON パース, 検証(zod), 既存カードとの差分計算（Phase 6）
    │   └─ firebase/          Firebase 初期化, Auth（Phase 4）
    ├─ repositories/
    │   ├─ types.ts           リポジトリ interface
    │   ├─ memory/            インメモリ実装（テスト・開発）
    │   └─ firestore/         Firestore 実装（converter, zod でのデータ検証）
    ├─ styles/                CSS（CSS 変数 + CSS Modules。UI ライブラリは使わない）
    └─ test/                  テストの共通設定（setup.ts）とテストデータ作成関数（factories.ts）
```

## 3. 採用ライブラリ

正確なバージョンは `package.json` と `package-lock.json` を参照。

| 用途 | ライブラリ | 理由 |
|---|---|---|
| ビルド | Vite 8 | 要件 |
| UI | React 19 | 要件 |
| 言語 | TypeScript 6.0 | typescript-eslint 8 の対応範囲が `<6.1` のため、TypeScript 7 ではなく 6.0 系に固定（`~6.0.x`）。typescript-eslint が対応したら更新を検討 |
| ルーティング | React Router 8（Data Mode：`createBrowserRouter`） | 5画面 + リロード・URL 直接アクセス・戻る/進むに対応。`RouterProvider` は `react-router/dom` から import する。Firebase Hosting では全パスを `index.html` に rewrite する（Phase 5 の `firebase.json`） |
| FSRS | ts-fsrs **5.4.2**（`--save-exact` で固定。内部アルゴリズムは FSRS-6.0） | 要件。FSRS の計算はすべて ts-fsrs に任せ、アプリ側でアルゴリズムを再実装しない |
| 検証 | 手書きの小さな検証（`repositories/firestore/validation.ts`） | Firestore の読み込みデータの検証には十分なため、検証ライブラリは追加していない。CSV / JSON インポート（Phase 6）で必要になれば改めて検討する |
| CSV | papaparse | 引用符・改行入り CSV を正しく扱うため自前実装しない |
| PWA | vite-plugin-pwa | manifest / Service Worker 生成 |
| テスト | Vitest 5, jsdom, @testing-library/react, @testing-library/user-event | Vite と統合。設定は `vitest.config.ts` |
| Firebase | firebase（JavaScript SDK）12.19.0（`--save-exact`） | Authentication（Phase 4）、Firestore（Phase 5）。SDK を import するのは `src/services/firebase/` と `src/repositories/firestore/` だけ |
| Firebase CLI | firebase-tools 15.32.1（devDependency、`--save-exact`） | Emulator での Rules テスト、デプロイ |
| Rules テスト | @firebase/rules-unit-testing 5.0.2 + Firestore Emulator | Java（21 以上を推奨）が必要なため `npm test` とは別コマンド（`npm run test:rules`） |
| Lint | ESLint 10 (flat config) + typescript-eslint（型情報を使う推奨ルール） | `no-restricted-imports` でレイヤー間の import を制限。制限が働くことは `tests/architecture/import-boundaries.test.ts` で確認 |

使わないもの：状態管理ライブラリ（Redux 等）、UI コンポーネントライブラリ、CSS フレームワーク、データ取得ライブラリ。React Context + hooks で足りる規模のため。

## 4. FSRS と Card / ReviewState の責務分離

```
Card（教材の中身）        ReviewState（FSRS の状態）      ReviewLog（履歴, 追記のみ）       MaterialProgress（集計）
 question / answer ...     due, stability, difficulty…     rating, reviewedAt               件数・評価回数・日別数
 examDifficulty            lastLogId, schedulerConfigId    previous / next スナップショット  newCursorOrder
 ↑ インポートで更新        ↑ レビューでのみ更新            ↑ レビューで1件追加               ↑ レビューごとに加算
```

- **Card** は「何を問うか」だけを持つ。学習に関する値を一切持たない。インポートで上書きされても構わない。
- **ReviewState** は「いつ・どれくらいの強さで覚えているか」。Card と同じ id の別ドキュメント。Card の更新では触らない。
- **ReviewLog** は真実の記録（source of truth）。レビュー前後の FSRS 状態の完全なスナップショットと、計算に使った FSRS 設定の id（`schedulerConfigId`）を持つ。ReviewState は「最新 ReviewLog の `nextState`」と一致するキャッシュで、欠落時はそこからコピーして復元する。
- **SchedulerConfig** は FSRS 設定（ts-fsrs のバージョン + パラメータ）の不変スナップショット。設定やライブラリを更新しても、過去のレビューがどの設定で計算されたか追跡できる。
- 用語の衝突を避ける：`Card.examDifficulty` は**問題そのものの難易度**（作成者が付ける）、`ReviewState.difficulty` は **FSRS の内部難易度**。

### src/lib/fsrs/（ts-fsrs を import する唯一の場所）

| ファイル | 役割 |
|---|---|
| `adapter.ts` | 変換だけを行う：`ReviewRating` ↔ `Rating`、`LearningPhase` ↔ `State`、`SchedulingSnapshot` ↔ ts-fsrs `Card`、ts-fsrs のパラメータ → `FsrsParams` |
| `scheduler.ts` | `createFsrsScheduler(settings, now)`：ts-fsrs のスケジューラーを作り、ドメイン型だけを入出力にした `FsrsScheduler` を返す |
| `index.ts` | 公開 API（`createFsrsScheduler`, `FsrsScheduler`, `RatingPreview`, `FSRS_LIBRARY_VERSION`）。外部からは内部ファイルを直接 import しない（ESLint で強制） |

```ts
interface FsrsScheduler {
  config: SchedulerConfig                                        // 実際に計算に使う設定（正規化後）
  newSnapshot(now): SchedulingSnapshot                           // ts-fsrs の createEmptyCard
  preview(current | null, now): RatingPreview                    // ts-fsrs の repeat（4 評価すべて。保存しない）
  apply(current | null, rating, now): SchedulingSnapshot         // ts-fsrs の next
}
```

- `current` が null（ReviewState がない新規カード）のときは、ts-fsrs の `createEmptyCard` で初期状態を作る。初期値をアプリ側で再現しない。
- ts-fsrs の `elapsed_days`（v6 で削除予定）はドメイン型に持たない。ts-fsrs が `last_review` とレビュー日時から計算し直すため、アダプターは 0 を渡す（テストで確認済み）。
- ライブラリのバージョンは ts-fsrs が公開する `FSRSVersion`（"v5.4.2 using FSRS-6.0"）から取り出すので、インストールされている実物と必ず一致する。

### FSRS の初期設定

ライブラリの暗黙の既定値には頼らず、アプリの初期値として明示する（`src/domain/settings.ts` の `DEFAULT_FSRS_SETTINGS`）。

| 項目 | 値 | 備考 |
|---|---|---|
| request_retention | 0.9 | |
| maximum_interval | 36500 | 日 |
| enable_fuzz | true | ts-fsrs 5.4.2 の既定値は false なので、明示が必要 |
| enable_short_term | true | |
| learning_steps | ['1m', '10m'] | 新規：Again 1 分 / Hard 6 分 / Good 10 分 / Easy は数日後 |
| relearning_steps | ['10m'] | |
| w（重み） | ts-fsrs 既定（21 個） | `fsrsWeights` が null のとき。将来の最適化結果はここに入る |

ts-fsrs の `generatorParameters` で正規化した後の、実際に計算に使う値を `SchedulerConfig.params` に記録する。

### services/reviewService.ts と services/studyService.ts

```ts
reviewCard({ scheduler, card, current, rating, reviewedAt, logId, durationMs, dayStartHour }): ReviewRecord
startStudySession(repos, materialId, now): { context, session }
submitReview(repos, context, session, { card, rating, reviewedAt, durationMs }): { session, record }
loadStudyOverview(repos, materialId, now): { material, counts }   // ホーム用。カードの内容は読まない
```

- `reviewCard` は保存しない純粋な組み立て：`previousState`（新規は null）→ `scheduler.apply` → `nextState`。ReviewState の FSRS 部分は `nextState` と同じ、`lastLogId = log.id`、評価回数を加算。
- `submitReview` がリポジトリの `recordReview(record)` で ReviewState・ReviewLog・集計をアトミックに保存してから、セッションに反映する。
- `startStudySession` は開始時に `prepareScheduler` で SchedulerConfig を保存し、`settings.activeSchedulerConfigId` を更新する（設定が変わったときだけ書き込む）。

### 次回予定の preview とレビュー日時

- 「答えを見る」を押した時点で `scheduler.preview` を計算し、各ボタンに「10分」「4日」などを表示する（`lib/formatInterval.ts`。表示用の文字列にするだけで due は変えない）。
- **正式なレビュー日時（`reviewedAt`）は評価ボタンを押した時刻。** 確定時に、その時刻で `scheduler.apply` を計算し直して保存する。preview は参考値。
- 答えを表示したまま 60 秒以上経ってから画面に戻った場合（`visibilitychange`）、preview を計算し直す。
- 時刻はすべて引数・`ClockContext` から受け取る（テストでは固定時刻を注入する）。

### 学習キュー（`src/domain/studyQueue.ts`。純粋関数）

| 種類 | 出題できる条件 | 並び順 | 上限 |
|---|---|---|---|
| ① 学習中（Learning / Relearning） | `due <= now`（時刻で判定。10 分後予定のカードをすぐには出さない） | due の早い順 | なし |
| ② 今日の復習（Review） | `due < 現在の学習日の終わり`（時刻を待たずに出す） | due の早い順 | **1 日の上限なし** |
| ③ 新規 | ReviewState がない | order 順 | `StudyMaterial.newCardsPerDay − 今日導入済み` |

- 優先順位は ① → ② → ③。次のカードを選ぶたびに `now` を評価し直すので、学習中に due になった ① のカードは自然にキューへ戻る（タイマーは使わない）。
- 出せるカードがなくなったら完了画面。まだ時刻が来ていない学習中カードがあれば「次の復習まであと○分」と「もう一度確認する」ボタンを表示する（自動更新はしない）。
- 件数は `reviewDueToday`・`learningDueNow`・`newAvailable`（と `learningLater`・`nextLearningDueAt`）を区別して返す（`StudyCounts`）。
- **学習日**：区切りは `AppSettings.dayStartHour`（初期値 4:00）。2026-10-06 03:00 は 10/5 の学習日、04:01 は 10/6 の学習日。「現在の学習日の終わり」は次の区切り時刻（`studyDayEnd`。例：10/6 10:00 → 10/7 04:00）。
- 読み込むのは「今日の学習日の終わりより前が期限の ReviewState」（`listDue({ dueBefore })`）と、今日の新規分のカードだけ（全件読み込みはしない）。
- セッション上限（「今回は 20 枚だけ」など）は未実装。追加する場合は `nextStudyItem` の手前で枚数を数えればよい。

## 5. 同期・保存方針

- **全件読み込みを前提にしない。** ホームは集計ドキュメント 1 件 + 今日の学習日内に期限が来る ReviewState、学習開始は期限到来分と必要な新規分だけをクエリで取得、統計は集計ドキュメント 1 件で表示する。ReviewLog は統計のために読まない。
- 1 レビュー = トランザクションで ReviewLog・ReviewState・集計を読み、整合性を確かめてから 3 つを書く（読み取り 3・書き込み 3）。同じ id・同じ内容の再送は何もせず成功する（二重登録しない）。詳細は DATA_MODEL.md §5。
- 評価を押すと保存が完了してから次のカードへ進む（保存中はボタンを無効化し、二重押しを防ぐ）。失敗したら日本語のエラーと「もう一度保存する」を表示し、同じ内容（同じ id・評価・日時）を再送する。保存中・未保存のままページを閉じようとしたら `beforeunload` で確認を出す。
- 複数端末で同じカードを同時に学習した場合：後から保存した側は、保存済みの状態が自分の `previousState` と違うため `conflict`（「別の端末などで先に学習されています。画面を再読み込み…」）になり、上書きしない。集計はトランザクションなのでずれない。
- Firestore の永続キャッシュ（IndexedDB）は MVP では使わない（複数タブ・古いキャッシュの問題を避け、「安全な同期」を優先）。

### 読み取り回数の見積もり

- 読み取り数は教材の総カード数ではなく、**その日に学習する枚数**に比例する。1 日 100 枚の復習 + 10 枚の新規なら、学習開始は約 220 読み取り、ホーム・統計は数回。
- 全件を読むのは、利用者が押したときだけの「再集計」のみ。
- 無料枠（読み取り 5 万/日、書き込み 2 万/日）に対して大きな余裕がある。

## 6. 認証とアクセス制御

### 構成（Phase 4）

```
main.tsx（組み立て）
  ├─ services/firebase/config.ts   readFirebaseConfig(import.meta.env)：不足時は変数名だけを返す → ConfigErrorPage
  ├─ services/firebase/app.ts      getFirebaseApp(config)：初期化は 1 回だけ
  └─ services/firebase/auth.ts     createFirebaseAuthGateway(app)：AuthGateway の Firebase 実装
                                    （Firebase の User → AppUser、エラー → 日本語の AppError は authErrors.ts）
app/AuthProvider.tsx   AuthGateway を購読し、認証状態を Context で配る（loading / unauthenticated / authorized / unauthorized）
app/AuthGate.tsx       全画面（404 を含む）の手前で状態に応じて 確認中 / ログイン画面 / 権限なし画面 / アプリ を表示
                       Owner のときだけ RepositoryFactory（利用者ごとのデータ層）でリポジトリを作る
services/auth/         AppUser・AuthGateway（interface）、ログイン方式の判定、Owner 判定（Firebase に依存しない）
```

- 画面・フック・サービスは `AuthGateway` interface と `AppUser` だけを知り、Firebase の型や SDK を知らない。`src/services/firebase/` を import できるのは `src/main.tsx` だけ（ESLint で強制）。テストは偽の AuthGateway（`src/test/fakeAuth.ts`）を使い、Firebase と通信しない。
- **ちらつき防止**：起動直後は Firebase から最初の認証状態が届くまで「確認中」だけを表示し、ログイン画面もアプリ画面も出さない。
- **画面の保護**：未ログインならその URL のままログイン画面を表示する。ログインすると同じ URL の画面がそのまま表示される（リダイレクト方式でも元の URL に戻る）。
- **データ層は利用者ごと**：Owner としてログインしたときに `RepositoryFactory(user)` でリポジトリを作り、利用者が変わる・ログアウトすると破棄する。Phase 4 まではメモリ上のダミーデータ、Phase 5 では `users/{uid}/...` の Firestore リポジトリになる。

### ログイン方式（`services/auth/signInMethod.ts`。Firebase の呼び出しと分離した純粋関数）

| 環境 | 方式 |
|---|---|
| localhost（ローカル開発） | `signInWithPopup`（リダイレクトに依存しない。ポップアップがブロックされても案内を出すだけ） |
| PC ブラウザ | `signInWithPopup`（ブロックされたら `signInWithRedirect` でやり直す） |
| ホーム画面の PWA（`display-mode: standalone` / iOS の `navigator.standalone`） | `signInWithRedirect` |
| スマートフォン（`pointer: coarse` かつ `hover` なし） | `signInWithRedirect` |

- User-Agent の解析はしない。
- 本番の最初のアクセス先は `https://<project-id>.firebaseapp.com`（`authDomain` と同じドメイン）。リダイレクト方式でもサードパーティ Cookie 制限の影響を受けない。`web.app` やカスタムドメインを使う場合は `authDomain` などの追加設定が必要になることがある（README 参照）。

### Owner 制限

- `VITE_OWNER_UID` とログイン中の UID が一致すれば authorized、違えば unauthorized（「このアカウントには利用権限がありません」＋ログアウト）。未設定ならすべて unauthorized で、自分の UID と設定方法を表示する。
- **この判定は画面上の制御（UX）であり、セキュリティの境界ではない。** 本当の境界は Phase 5 の Firestore Security Rules（下記）。

### Firestore でのアクセス制御（本当のセキュリティ境界）

- データは `users/{uid}/...` 配下に置き、Security Rules で `request.auth.uid == uid` **かつ** `uid == Owner の UID` の場合のみ許可（クライアントの `VITE_OWNER_UID` は信用しない）。
- Owner の UID はリポジトリにコミットしない方針とし、`firestore.rules.template` から `scripts/firebase-prepare.mjs`（`npm run firebase:prepare`）が `.env.local` の `VITE_OWNER_UID` で `firestore.rules` を生成してデプロイする（UID は認証情報ではないが、個人を特定する値を残さないため。アプリ側と同じ値を 1 か所で管理する）。
- ReviewLog は **create のみ（update / delete 禁止）**、SchedulerConfig も作成のみ、delete はどこにも許可しない。ReviewState は参照する ReviewLog が存在する場合だけ保存できる。詳細は DATA_MODEL.md §5。

## 6.5 Firebase CLI と Hosting

| ファイル | Git | 内容 |
|---|---|---|
| `firebase.json` | ✓ | Firestore の Rules / Indexes の場所、Hosting（`dist/`、全パスを `/index.html` に rewrite、`/assets/` は長期キャッシュ・それ以外は `no-cache`） |
| `firebase.emulator.json` | ✓ | Rules テスト用（Emulator のみ。`demo-` プロジェクトで本番に接続しない） |
| `firestore.rules.template` | ✓ | Security Rules の正本 |
| `firestore.indexes.json` | ✓ | 複合インデックス（DATA_MODEL.md §6） |
| `firestore.rules` | ✕（生成） | `npm run firebase:prepare` が生成 |
| `.firebaserc` | ✕（生成） | `npm run firebase:prepare` が `VITE_FIREBASE_PROJECT_ID` から生成 |

- デプロイは利用者の承認を得てから手動で行う（npm scripts に `deploy` は用意しない）。手順は README。
- 本番の最初のアクセス先は `https://<project-id>.firebaseapp.com`（authDomain と同じ）。

## 7. エラー処理

- `domain/errors.ts` に `AppError`（種別 + 日本語メッセージ）を定義。Firestore / Auth のエラーコードはリポジトリ層・Auth 層で `AppError` に変換し、UI は日本語メッセージを表示するだけにする。
- ルートと各ページに Error Boundary。
- Firestore のエラーコード（permission-denied・unauthenticated・unavailable・aborted・failed-precondition など）は `repositories/firestore/errors.ts` で日本語の `AppError` に変換する。コードをそのまま画面に出さない。
- Firestore から読み込んだ ReviewState が不正、または ReviewLog があるのに ReviewState がない場合は `CorruptedReviewStateError` を投げ、学習画面で「学習履歴から復元する」を表示する（黙って修復しない）。復元は `services/restoreService.ts`。
- レビュー保存の失敗は学習画面にエラーと「もう一度保存する」を表示する。

## 8. 将来拡張の受け皿

- **模擬試験モード**：`services/exam/selectExamCards(cards, criteria)`（カテゴリー・件数・ランダム）を純粋関数で追加し、結果は `users/{uid}/materials/{m}/examSessions` に保存。`reviewService` と ReviewState には一切触れない。
- **FSRS パラメータ最適化**：ReviewLog に必要な値（rating, reviewedAt, previousState / nextState）を保存しているため、後から `@open-spaced-repetition/binding` 等で最適化し、`settings.fsrsWeights` に保存できる。新しい設定は新しい SchedulerConfig として記録される。
- **別バックエンド**：`repositories/types.ts` の interface を実装すればよい。
