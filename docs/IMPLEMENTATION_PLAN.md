# 実装計画 (IMPLEMENTATION_PLAN)

最終更新: 2026-10-05 / Phase 3

## 1. 当初案からの変更点と理由

| 変更 | 理由 |
|---|---|
| Phase 2 で**リポジトリ interface とインメモリ実装**を作る | Phase 3 の FSRS 学習フローを Firebase なしで動かし・テストできる。Firestore はあとで実装を差し替えるだけになる |
| **Security Rules と Rules テストを Phase 5（Firestore 同期）に前倒し** | Rules なしの Firestore を一度でも使う期間を作らないため。セキュリティは最後に回さない |
| Phase 5 の最後に**初回デプロイ**（Hosting） | スマホからの Google ログインと別端末同期は、実際の Hosting ドメインで確認するのが確実 |
| Phase 7（複数教材）は**UI のみ** | データモデルは Phase 2 から複数教材前提。Phase 7 は教材の作成・編集・切り替え画面だけになり小さい |
| インポートの**パース・検証・差分計算は純粋関数**として Phase 6 で実装 | Firestore なしでユニットテストできる |
| 統計は教材ごとの集計ドキュメント（`progress/summary`）1 件から表示 | 統計画面のために ReviewLog・ReviewState を全件読む必要をなくす（無料枠対策） |
| ホーム・学習開始は期限到来分と必要な新規分だけをクエリ | 読み取り数を「教材の総カード数」ではなく「その日に学習する枚数」に比例させる |
| ReviewLog に previousState / nextState の FSRS スナップショットと設定・ライブラリバージョンへの参照を保存 | ReviewState を再計算なしで安全に復元でき、ts-fsrs のバージョンや設定変更後も過去の計算を追跡できる |

## 2. 不要に複雑になりやすい点と対処

- **オフライン編集同期**：MVP では実装しない。Firestore の永続キャッシュも使わない。
- **FSRS 設定の記録**：ReviewLog に毎回パラメータ全体をコピーせず、不変の SchedulerConfig ドキュメントの id だけを持たせる。
- **ReviewLog からの再計算**：MVP では実装しない。復元は「最新 ReviewLog の `nextState` をコピー」だけで足りる。
- **集計のずれ**：レビュー時は `increment()` で加算するだけにし、カテゴリー変更などによるずれは手動の「再集計」で直す（自動の整合処理は作らない）。
- **教材ごとの FSRS パラメータ**：不要。全教材共通。
- **Firebase Storage**：Spark では新規利用不可のため使わない。画像は外部 URL か Hosting の `public/images/`。
- **Rules テスト**：Java + Emulator が必要なので `npm run test:rules` として分離し、`npm test` は常に単体で通るようにする。
- **ブランチ運用**：git-flow や develop ブランチは使わない（下記参照）。
- **ユーザー管理**：許可ユーザーは 1 人なので、ユーザー一覧や権限テーブルは作らない（Rules に Owner UID を埋め込むだけ）。

## 3. フェーズ

各フェーズの最後に必ず `npm run typecheck && npm run lint && npm test && npm run build` を実行し、すべて成功させる。

### Phase 0：要件整理と設計 ✅（このドキュメント）
- 成果物：docs/*.md, CLAUDE.md

### Phase 1：基本構成（branch: `feature/setup`）✅
- Vite + React + TypeScript のプロジェクト作成。
- ESLint（レイヤー間 import 制限を含む）、Vitest、`typecheck` / `lint` / `test` / `build` の npm scripts。
- `.gitignore`（`.env*`, `firestore.rules`（生成物）, `node_modules`, `dist`, Firebase のデバッグログなど）、`.env.example`。
- react-router による 5 画面のスケルトンと下部タブバー（mobile-first のレイアウト）。
- README.md の初版（起動・テスト・build 方法）。
- コミット例：`chore: scaffold Vite React TypeScript app`, `chore: add lint and test tooling`, `feat: add app shell with bottom navigation`

### Phase 2：ドメインモデルとメモリ上のデータ層（branch: `feature/domain-model`）✅
- `src/domain/`：StudyMaterial, Card, ReviewRating, LearningPhase, SchedulingSnapshot, ReviewState, ReviewLog, FsrsParams, SchedulerConfig, SchedulerRef, MaterialProgress, AppSettings, AppError の型と、純粋関数（未学習判定、期限判定、新規カードの order 順取り出し、期限到来カードの取り出し、集計の加算 / 再集計、学習日、FSRS 設定 id、カード id 検証）。
- `src/repositories/types.ts` の interface（必要分だけを取るメソッド。ReviewLog の変更・削除メソッドなし）と `src/repositories/memory/` の実装。
- `src/dev/sampleData.ts`：ダミー教材 2 つ（日本城郭検定3級 15 枚・テスト用教材 5 枚うち 1 枚アーカイブ）、画像付き 2 枚（`public/images/samples/` の自作 SVG）。
- 教材画面にメモリ上の教材名とカード数を表示（動作確認用の最小限の接続）。
- CSV / JSON のサンプルファイル（`samples/`）は、インポート形式を実装する Phase 6 で作成する。

### Phase 3：FSRS 学習フロー（branch: `feature/fsrs-review`）✅
- ts-fsrs 5.4.2 を導入（バージョン固定）。`src/lib/fsrs/`：アダプター（ドメイン型 ↔ ts-fsrs）とスケジューラー（preview / apply、SchedulerConfig の生成）。
- FSRS の初期設定をアプリ側で明示（`DEFAULT_FSRS_SETTINGS`）。正規化後の値を SchedulerConfig に記録。
- `src/domain/studyQueue.ts`：Learning（due <= now）・Review（学習日内、上限なし）・New（order 順、1 日の上限）のキュー。学習日の終わり（`studyDayEnd`、4:00 区切り）。
- `src/services/`：`reviewCard`（ReviewState・ReviewLog・集計用情報の組み立て）、`startStudySession` / `submitReview` / `loadStudyOverview`。
- 学習画面（問題 → 答えを見る → 4 評価 + 次回予定 → 次の問題、画像と代替表示、完了画面と「次の復習まであと○分」）とホーム画面（教材・今日の復習・学習中・新規・開始ボタン）。
- データはメモリ上のみ（再読み込みで消える。localStorage には保存しない）。
- FSRS 状態欠落時の復元（最新 ReviewLog の `nextState` から）は、Firestore のデータ検証と合わせて Phase 5 で実装する（メモリ実装では状態が壊れる経路がないため）。

### Phase 4：Firebase Authentication（branch: `feature/firebase-auth`）
- **利用者の作業が必要**：Firebase プロジェクト作成（Spark）、Web アプリ登録、Google ログイン有効化、`.env.local` 作成。手順は README に書く。
- `services/firebase/`（初期化・Auth）、ログイン画面、AuthGate、ログイン失敗の日本語表示。
- コミット例：`feat: add Firebase authentication`

### Phase 5：Firestore 同期 + Security Rules（branch: `feature/firestore`）
- **利用者の作業が必要**：Firestore データベース作成（ロケーション `asia-northeast1`）、自分の UID を `.env.local` の `OWNER_UID` に設定、Firebase CLI へのログイン。
- `repositories/firestore/`（converter、zod 検証、batch 保存、`increment()` による集計、`count()` 集計）、`firestore.indexes.json`。
- 保存状態表示（保存中 / 未保存 n 件 / 再試行）、`beforeunload` 警告。
- `firebase.json`（Hosting は全パスを `/index.html` に rewrite して URL 直接アクセスに対応）。
- `firestore.rules.template`, `scripts/build-rules.mjs`, `tests/rules/`（ESLint の import 制限で `tests/rules/` に Firebase SDK を許可する設定を追加）（Owner のみ可、他ユーザー不可、未ログイン不可、ReviewLog 更新・削除不可）。
- 初回デプロイ（Hosting + Rules）。**デプロイ前に利用者の確認を取る。**
- 確認：PC とスマホで同じ履歴が見えること、リロードしても壊れないこと。
- コミット例：`feat: add Firestore repositories`, `feat: add Firestore security rules`, `test: add security rules tests`

### Phase 6：CSV / JSON インポート（branch: `feature/import`）
- `services/import/`（papaparse, zod 検証, 差分分類）とインポート画面（プレビュー → 更新/スキップ選択 → 確定）。
- テスト：CSV/JSON パース、BOM、必須欠落、不正な数値、ファイル内重複、新規/更新/変更なし分類、更新時に ReviewState / ReviewLog が保持されること。
- コミット例：`feat: add CSV and JSON card import`, `test: add import validation tests`

### Phase 7：複数教材（branch: `feature/materials`）
- 教材の作成・編集（名前・説明・新規カード数・有効/無効）、選択した教材の記憶（`lastMaterialId`）、カード一覧とアーカイブ。
- コミット例：`feat: add material management`

### Phase 8：統計（branch: `feature/stats`）
- `services/statsService.ts`（集計ドキュメントから各指標を計算、再集計ロジック）と成績画面（教材別・カテゴリー別、直近 7 日、「再集計」ボタン）。
- テスト：各指標の計算、アーカイブ除外、0 件時の表示、再集計結果と増分集計の一致。
- コミット例：`feat: add study statistics`

### Phase 9：PWA（branch: `feature/pwa`）
- vite-plugin-pwa、manifest、アイコン（192/512/maskable、apple-touch-icon）、Service Worker 更新通知。
- Hosting のキャッシュヘッダー（`index.html` と `sw.js` はキャッシュしない）。
- 確認：Android / iOS でホーム画面に追加、standalone でのログイン。
- コミット例：`feat: add PWA manifest and service worker`

### Phase 10：MVP 仕上げ（branch: `feature/mvp-polish`）
- MVP 完成条件（REQUIREMENTS.md §8）を 1 項目ずつ確認。
- エラー表示の総点検、アクセシビリティ（ボタンサイズ、コントラスト）。
- README・docs の最終更新。
- 任意：GitHub Actions で typecheck / lint / test / build（無料枠内）。導入前に確認を取る。

## 4. Git 運用方針

- `main` は常に「typecheck / lint / test / build が通る」状態に保つ。
- フェーズごとに `feature/<name>` ブランチ（ドキュメントのみなら `docs/<name>`）を切り、意味のある単位で小さくコミットする。
- push・マージは利用者の確認後に行う。

### main へのマージ手順（PR を使わない場合）

ドキュメントのみの変更など、レビューが不要なときは fast-forward のみで安全にマージする。

```bash
git switch main
git pull --ff-only origin main            # リモートの main を取り込む（履歴が分岐していたら失敗して止まる）
git merge --ff-only docs/initial-design   # main を先に進めるだけ。分岐していれば失敗して止まる
npm run typecheck && npm run lint && npm test && npm run build   # Phase 1 以降
git push origin main
git branch -d docs/initial-design         # マージ済みの場合だけ削除される（-D は使わない）
git push origin --delete docs/initial-design   # 任意：リモートのブランチも片付ける
```

- `--ff-only` は履歴を書き換えず、分岐があると何もせずに失敗するので安全。失敗したら、マージコミットを作るか PR にするかを利用者に相談する。
- アプリのコードを含むフェーズは、GitHub の Pull Request で差分を一覧してからマージすることを推奨（変更の記録が残り、後から確認しやすい）。
- 禁止：force push、`reset --hard`、rebase による公開済み履歴の書き換え、`--no-verify`。
- コミット前に `git status` と `git diff --staged` で内容（特に秘密情報）を確認する。
- コミットメッセージは英語の Conventional Commits（`feat:`, `fix:`, `test:`, `docs:`, `chore:`, `refactor:`）。

## 5. 決定事項

| 事項 | 決定 | 決定日 |
|---|---|---|
| Firestore のロケーション | `asia-northeast1`（東京） | 2026-10-04 |
| GitHub リポジトリ | Private | 2026-10-04 |
| 問題の難易度 | `Card.examDifficulty`：1〜5 の整数、任意 | 2026-10-04 |
| 重要度 | `Card.importance`：1〜5 の整数、任意 | 2026-10-04 |
| FSRS 内部の difficulty | `ReviewState.difficulty`（Card 側とは別名で区別） | 2026-10-04 |
| ts-fsrs のバージョン | 5.4.2（固定） | 2026-10-05 |
| FSRS の初期設定 | retention 0.9 / 最大間隔 36500 日 / fuzz あり / short term あり / 学習ステップ 1m・10m / 再学習ステップ 10m | 2026-10-05 |
| 1 日の区切り時刻 | 4:00（`AppSettings.dayStartHour`） | 2026-10-05 |
| 今日の復習の判定 | Review は学習日の終わりまでに期限が来るもの。Learning / Relearning は due <= now のもの | 2026-10-05 |
| 復習の 1 日上限 | 設けない（新規のみ `newCardsPerDay` で制限） | 2026-10-05 |

## 6. 未決定事項（推奨案で進め、必要なら変更）

| # | 事項 | 推奨 | 期限 |
|---|---|---|---|
| 1 | Owner UID を Git に含めるか | 含めない（テンプレート + 生成スクリプト） | Phase 5 |
| 2 | 画像の置き場所 | 外部 URL と `public/images/` の併用。配信 URL は誰でもアクセスできる点に注意 | Phase 6 |
| 3 | 新規カードの出題順 | インポート順（現在の実装。将来：重要度順・ランダムを設定で選択） | Phase 7 |
| 4 | 問題文の書式 | プレーンテキスト（改行のみ。現在の実装）。将来必要なら簡易 Markdown | Phase 6 |
| 5 | GitHub Actions による CI | Phase 10 で導入（private リポジトリは月 2,000 分まで無料） | Phase 10 |
