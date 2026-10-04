# アーキテクチャ (ARCHITECTURE)

最終更新: 2026-10-04 / Phase 0（改訂 1）

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
| `domain/` | なし（型と純粋関数のみ） | React, firebase, ts-fsrs |
| `lib/fsrs/` | `ts-fsrs`, `domain/` | React, firebase |
| `services/` | `domain/`, `lib/fsrs/`, `repositories/types` | React, firebase, ts-fsrs 直接 |
| `repositories/firestore/` | `firebase/*`, `domain/` | React, ts-fsrs |
| `hooks/`, `pages/`, `components/` | `services/`, `domain/`, リポジトリはコンテキスト経由 | `firebase/*`, `ts-fsrs` 直接 |

これにより：
- バックエンドを Firestore から別のものに替えても、`repositories/` の実装を差し替えるだけで UI と FSRS ロジックを再利用できる。
- ts-fsrs の API 変更（例：v6 での `elapsed_days` 削除）の影響を `lib/fsrs/` に閉じ込められる。

## 2. ディレクトリ構成（予定）

```
fsrs-study-app/
├─ CLAUDE.md
├─ README.md
├─ docs/                      設計ドキュメント
├─ .env.example               必要な環境変数のキー名のみ
├─ firebase.json              Hosting / Firestore / Emulator 設定
├─ firestore.rules.template   Security Rules（Owner UID はプレースホルダ）
├─ firestore.indexes.json
├─ scripts/
│   └─ build-rules.mjs        .env.local の OWNER_UID から firestore.rules を生成（生成物は gitignore）
├─ public/
│   ├─ icons/                 PWA アイコン
│   └─ images/                画像付きカード用（任意）
├─ samples/
│   ├─ castle-3-dummy.csv     ダミー教材（20問）
│   └─ test-material.json
├─ tests/
│   └─ rules/                 Security Rules テスト（Emulator 使用、別コマンド）
└─ src/
    ├─ main.tsx
    ├─ app/                   App, ルーター, AuthGate, ErrorBoundary, Provider
    ├─ pages/                 HomePage, StudyPage, MaterialsPage, ImportPage, StatsPage, SettingsPage, LoginPage
    ├─ components/            共通 UI（Button, RatingButtons, CardView, CardImage, ErrorMessage, TabBar …）
    ├─ hooks/                 useMaterials, useStudySession, useStats …
    ├─ domain/                型定義, 日付境界（dayKey）, id 検証, Result 型, AppError
    ├─ lib/
    │   └─ fsrs/              scheduler.ts（ts-fsrs ラッパー）, intervalLabel.ts
    ├─ services/
    │   ├─ studyQueue.ts      今日の出題キュー生成（純粋関数）
    │   ├─ reviewService.ts   評価 → 新 ReviewState + ReviewLog（純粋関数）
    │   ├─ statsService.ts    統計集計（純粋関数）
    │   ├─ import/            CSV/JSON パース, 検証(zod), 既存カードとの差分計算
    │   └─ firebase/          Firebase 初期化, Auth（signIn/signOut/監視）
    ├─ repositories/
    │   ├─ types.ts           リポジトリ interface
    │   ├─ memory/            インメモリ実装（テスト・開発）
    │   └─ firestore/         Firestore 実装（converter, zod でのデータ検証）
    └─ styles/                CSS（CSS 変数 + CSS Modules。UI ライブラリは使わない）
```

## 3. 採用ライブラリ（バージョンは Phase 1 で実際に確認・固定）

| 用途 | ライブラリ | 理由 |
|---|---|---|
| ビルド | Vite | 要件 |
| UI | React | 要件 |
| ルーティング | react-router | 5画面 + リロード時に画面を維持するため URL が必要 |
| FSRS | ts-fsrs | 要件 |
| 検証 | zod | インポート検証と Firestore 読み込みデータの検証（FSRS 状態破損検出）を同じ仕組みで行う |
| CSV | papaparse | 引用符・改行入り CSV を正しく扱うため自前実装しない |
| PWA | vite-plugin-pwa | manifest / Service Worker 生成 |
| テスト | Vitest, @testing-library/react | Vite と統合 |
| Rules テスト | @firebase/rules-unit-testing + Firestore Emulator | Java が必要なため `npm test` とは別コマンド |
| Lint | ESLint (flat config) + typescript-eslint | — |

使わないもの：状態管理ライブラリ（Redux 等）、UI コンポーネントライブラリ、CSS フレームワーク、データ取得ライブラリ。React Context + hooks で足りる規模のため。

## 4. FSRS と Card / ReviewState の責務分離

```
Card（教材の中身）        ReviewState（FSRS の状態）      ReviewLog（履歴, 追記のみ）       MaterialProgress（集計）
 question / answer ...     due, stability, difficulty…     rating, reviewedAt               件数・評価回数・日別数
 examDifficulty            lastLogId, schedulerConfigId    before / after スナップショット   newCursorOrder
 ↑ インポートで更新        ↑ レビューでのみ更新            ↑ レビューで1件追加               ↑ increment で加算
```

- **Card** は「何を問うか」だけを持つ。学習に関する値を一切持たない。インポートで上書きされても構わない。
- **ReviewState** は「いつ・どれくらいの強さで覚えているか」。Card と同じ id の別ドキュメント。Card の更新では触らない。
- **ReviewLog** は真実の記録（source of truth）。レビュー前後の FSRS 状態の完全なスナップショットと、計算に使った FSRS 設定の id（`schedulerConfigId`）を持つ。ReviewState は「最新 ReviewLog の `after`」と一致するキャッシュで、欠落時はそこからコピーして復元する。
- **SchedulerConfig** は FSRS 設定（ts-fsrs のバージョン + パラメータ）の不変スナップショット。設定やライブラリを更新しても、過去のレビューがどの設定で計算されたか追跡できる。
- 用語の衝突を避ける：`Card.examDifficulty` は**問題そのものの難易度**（作成者が付ける）、`ReviewState.difficulty` は **FSRS の内部難易度**。

### lib/fsrs/scheduler.ts（ts-fsrs を import する唯一のファイル群）

```ts
createScheduler(settings): { scheduler; config: SchedulerConfig }  // config.id は バージョン + パラメータのハッシュ
newFsrsSnapshot(now: Date): FsrsSnapshot                           // createEmptyCard
previewRatings(snapshot, now): Record<Grade, { due: Date; scheduledDays: number }>  // repeat
applyRating(snapshot, rating, now): FsrsSnapshot                   // next
recomputeFromHistory(reviews): FsrsSnapshot                        // reschedule（将来・利用者の明示操作のみ）
```

`FsrsSnapshot` はアプリ側の型（ts-fsrs の `Card` と同じフィールド構成のプレーンオブジェクト）。ts-fsrs の型をアプリ全体に漏らさない。ts-fsrs のバージョンはビルド時に `package.json` から埋め込む。

### services/reviewService.ts（純粋関数）

```ts
reviewCard({ card, currentState?, rating, now, logId, scheduler }):
  { newState: ReviewState; log: ReviewLog; progressDelta: ProgressDelta }
```
- `currentState` がなければ新規カードとして `newFsrsSnapshot(now)` から開始し（`log.before = null`）、`firstReviewedAt = now`。
- `log.after` と `newState` の FSRS 値は同じスナップショット。`newState.lastLogId = logId`。
- 戻り値をリポジトリの `saveReview(newState, log, progressDelta)` が 1 つの batch で書き込む（アトミック。集計は `increment()`）。

### services/studyQueue.ts（純粋関数）

```ts
buildStudyQueue({ dueStates, dueCards, newCards, now }): QueueItem[]
remainingNewCount({ progress, material, todayKey }): number
```
リポジトリは「必要な分だけ」を取得し、キュー生成はそれを並べるだけ（全件読み込みを前提にしない。読み取り数は DATA_MODEL.md §3）。
1. **期限到来の復習カード**：`suspended == false && due <= now`。due の早い順。
2. **今日の新規カード**：上限 = `newCardsPerDay − progress.daily[今日].newCards`。`order > newCursorOrder` のカードを順に取得。
3. セッション中、学習ステップ（数分後に再出題）のカードはメモリ上で due になった時点でキューに戻す。出せるカードがないときは 20 分以内に due になる学習中カードを先出しする。

「今日」は `dayStartHour`（初期値 4 時）を境界とするローカル日付で判定する（`domain/date.ts` の `dayKey`）。

## 5. 同期・保存方針

- **全件読み込みを前提にしない。** ホームは集計ドキュメント 1 件 + `count()`、学習開始は期限到来分と必要な新規分だけをクエリで取得、統計は集計ドキュメント 1 件で表示する。ReviewLog は統計のために読まない。
- 1 レビュー = `writeBatch` で ReviewState の set + ReviewLog の create + 集計の increment（書き込み 3 回）。
- 保存は非同期。UI は次のカードへ進みつつ「保存中 / 未保存 n 件」を表示。失敗したら保持して再試行ボタンを出す。未保存がある状態でページを閉じようとしたら `beforeunload` で警告。
- 複数端末で同じカードを同時に学習した場合：ReviewLog は両方残る（追記のみ）。ReviewState は後勝ち。集計は `increment()` なのでずれない。個人利用では許容する。
- Firestore の永続キャッシュ（IndexedDB）は MVP では使わない（複数タブ・古いキャッシュの問題を避け、「安全な同期」を優先）。

### 読み取り回数の見積もり

- 読み取り数は教材の総カード数ではなく、**その日に学習する枚数**に比例する。1 日 100 枚の復習 + 10 枚の新規なら、学習開始は約 220 読み取り、ホーム・統計は数回。
- 全件を読むのは、利用者が押したときだけの「再集計」のみ。
- 無料枠（読み取り 5 万/日、書き込み 2 万/日）に対して大きな余裕がある。

## 6. 認証とアクセス制御

- Google ログイン：`signInWithPopup` を基本とし、スマホ・PWA（standalone）では `signInWithRedirect` を使う。Firebase Hosting 上で配信し `authDomain` を Hosting ドメインに合わせることで、リダイレクト方式のサードパーティ Cookie 問題を避ける。
- データは `users/{uid}/...` 配下に置き、Security Rules で `request.auth.uid == uid` **かつ** `uid == OWNER_UID` の場合のみ許可。
- `OWNER_UID` は Git にコミットしない方針とし、`firestore.rules.template` から `scripts/build-rules.mjs` が `.env.local` の値で `firestore.rules` を生成してデプロイする（UID は認証情報ではないが、個人を特定する値を公開リポジトリに残さないため）。
- ReviewLog は Rules で **create のみ許可（update / delete 禁止）**。Card / ReviewState / Material も delete 禁止（アーカイブで対応）。バグによる履歴破壊を Rules レベルで防ぐ。

## 7. エラー処理

- `domain/errors.ts` に `AppError`（種別 + 日本語メッセージ）を定義。Firestore / Auth のエラーコードはリポジトリ層・Auth 層で `AppError` に変換し、UI は日本語メッセージを表示するだけにする。
- ルートと各ページに Error Boundary。
- Firestore から読み込んだ ReviewState は zod で検証する。不正なものはそのカードの最新 ReviewLog の `after` から復元して警告を出す。ReviewLog もない場合は未学習として扱う。

## 8. 将来拡張の受け皿

- **模擬試験モード**：`services/exam/selectExamCards(cards, criteria)`（カテゴリー・件数・ランダム）を純粋関数で追加し、結果は `users/{uid}/materials/{m}/examSessions` に保存。`reviewService` と ReviewState には一切触れない。
- **FSRS パラメータ最適化**：ReviewLog に必要な値（rating, reviewedAt, before/after）を保存しているため、後から `@open-spaced-repetition/binding` 等で最適化し、`settings.fsrsWeights` に保存できる。新しい設定は新しい SchedulerConfig として記録される。
- **別バックエンド**：`repositories/types.ts` の interface を実装すればよい。
