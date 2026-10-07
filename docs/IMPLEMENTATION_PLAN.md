# 実装計画 (IMPLEMENTATION_PLAN)

最終更新: 2026-10-06 / Phase 5

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
- **集計のずれ**：レビュー時はトランザクションで集計に加算するだけにし、カテゴリー変更などによるずれは手動の「再集計」で直す（自動の整合処理は作らない）。
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

### Phase 4：Firebase Authentication（branch: `feature/firebase-auth`）✅
- firebase 12.19.0 を導入（Authentication のみ使用。Firestore はまだ作成・使用しない）。
- `src/services/firebase/`：設定の読み取り（不足時は変数名を表示）、初期化、AuthGateway の Firebase 実装、エラーの日本語化。
- `src/services/auth/`：AppUser / AuthGateway の型、ログイン方式の判定（localhost・PC はポップアップ、スマホ・PWA はリダイレクト）、Owner 判定。
- `AuthProvider`（Context）と `AuthGate`（全画面の保護）。ログイン・権限なし・設定不足の画面。設定画面からログアウト。
- データ層を利用者ごとに作る `RepositoryFactory`（ログアウトで破棄）。メモリ上の学習機能はそのまま。
- **利用者の作業**：Firebase プロジェクト作成、Web アプリ登録、Google ログイン有効化、`.env.local` の設定（README の手順）。
- 注意：`npm audit` が firebase 内の `@grpc/grpc-js`（Firestore の Node.js 用通信部分）について high を報告する。ブラウザ版では使われない部分で、提示される修正は firebase 9 への格下げ（破壊的変更）のため適用しない。firebase の更新時に再確認する。

### Phase 5：Firestore 同期・Security Rules・初回 Hosting（branch: `feature/firestore-sync`）✅
- Firestore（Standard edition、`(default)`、`asia-northeast1`）は利用者が作成済み。リージョン・データベースは変更しない。
- `src/repositories/firestore/`：Repository interface の Firestore 実装、Date ↔ Timestamp 変換、読み込みデータの検証（手書き）、エラーの日本語化。レビュー保存はトランザクション（ReviewLog の id による二重登録防止・別端末との競合検出）。
- メモリ実装と Firestore 実装を同じ契約テスト（`repositoryContract.ts`）で確認。
- ReviewState の破損・欠落の検出（`CorruptedReviewStateError`）と、利用者が選んだときだけの履歴からの復元（`restoreService.ts`）。
- 学習画面：保存失敗時の「もう一度保存する」（同じ内容の再送）、二重押しの防止、未保存時の `beforeunload` 確認。
- `firestore.rules.template`・`tests/rules/`（Emulator）・`firestore.indexes.json`・`firebase.json`（Hosting：`dist/`、SPA の rewrite、キャッシュ設定）・`scripts/firebase-prepare.mjs`。
- 開発用のダミーデータ投入（開発サーバーの設定画面だけに表示。本番ビルドには含まれない）。
- `npm audit`：firebase-tools（開発用ツール）由来の moderate / high が増える。アプリには含まれない。firebase 本体の `@grpc/grpc-js` は Phase 4 の記載どおり。
- 本番デプロイ・PC / スマートフォンでの実機確認・Firestore の整合性確認まで完了（2026-10-06）。

### Phase 5.1：性能改善（branch: `feature/performance`）✅
- 計測：開発時・オプトインの計測ログ（`src/lib/perf.ts`）。
- 学習データの読み込みを依存関係ごとの段にまとめて並列化（学習開始 7 段 → 4 段、ホームのデータ再利用時 2 段。ホーム 3 段 → 2 段）。重複していた設定・教材の読み取りを削除。
- Firestore Lite は比較検証したが、この環境では通常版より読み取りの往復時間が大きかったため採用しない（ARCHITECTURE.md「性能に関する設計判断」）。
- 評価の保存は single-flight optimistic navigation（案 D）：トランザクションの完了を待たずに次の問題を表示するが、保存待ちは最大 1 件で、前の回答の保存が終わるまで次の評価はできない。
- 未着手：ホーム表示後の学習データの先読み（案 C。現時点では不要と判断）。
- 本番デプロイ（Hosting）・実機確認・Firestore の整合性確認まで完了（2026-10-07）。

### Phase 6：CSV / JSON インポート（branch: `feature/import`）実装済み・本番確認待ち
- `src/services/import/`：parse（papaparse / JSON）→ normalize・検証 → plan（新規・更新・変更なし）→ execute（400 件ずつ保存 → 集計を全件から作り直し）。仕様は DATA_MODEL.md §4。
- インポート画面（教材 → 問題をインポート）：ファイル選択 → プレビュー → 実行（進捗）→ 結果。検証エラーの表示、二重実行の防止、取り込み中の離脱確認、途中失敗時の再実行の案内、集計の作り直しのやり直し。
- リポジトリに `getMaxOrder` / `listAll`（カード）、`listAllStates`（学習状態）を追加。Firestore の一括書き込みは 400 件ずつ。
- サンプル：`samples/import/castle-3-sample.csv`（日本城郭検定3級・開発用ダミー）、`samples/import/test-material-sample.json`（テスト用教材）。
- 本物の教材の作成は、本番での動作確認の後の別フェーズで行う。

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
| Firebase JS SDK のバージョン | 12.19.0（固定） | 2026-10-05 |
| ログイン方式 | localhost・PC はポップアップ、スマホ・PWA はリダイレクト | 2026-10-05 |
| 本番の最初のアクセス先 | `https://<project-id>.firebaseapp.com`（authDomain と同じ） | 2026-10-05 |
| Owner の UID の管理 | `.env.local` の `VITE_OWNER_UID`（アプリと Rules の生成で共用。コミットしない） | 2026-10-05 |
| Firestore | Standard edition・`(default)`・`asia-northeast1`（Production mode で作成済み） | 2026-10-06 |
| レビューの保存方式 | トランザクション（バッチではなく。既存の状態・履歴・集計を読んで整合性を確かめるため） | 2026-10-06 |
| `.firebaserc` | Git に入れず `.env.local` から生成 | 2026-10-06 |

## 6. 未決定事項（推奨案で進め、必要なら変更）

| # | 事項 | 推奨 | 期限 |
|---|---|---|---|
| 1 | 画像の置き場所 | 外部 URL と `public/images/` の併用。配信 URL は誰でもアクセスできる点に注意 | Phase 6 |
| 2 | 新規カードの出題順 | インポート順（現在の実装。将来：重要度順・ランダムを設定で選択） | Phase 7 |
| 3 | 問題文の書式 | プレーンテキスト（改行のみ。現在の実装）。将来必要なら簡易 Markdown | Phase 6 |
| 4 | GitHub Actions による CI | Phase 10 で導入（private リポジトリは月 2,000 分まで無料） | Phase 10 |
