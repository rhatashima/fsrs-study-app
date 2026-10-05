# CLAUDE.md

このリポジトリで作業する Claude Code が守るルール。詳細は `docs/` を参照。

## プロジェクト概要

個人用の FSRS 汎用学習 Web アプリ（React + TypeScript + Vite / ts-fsrs / Firebase Auth + Firestore + Hosting / PWA）。
利用者は 1 名。最初の教材は「日本城郭検定3級」だが、**汎用システム**として作る。

- 要件：`docs/REQUIREMENTS.md`
- 設計：`docs/ARCHITECTURE.md`
- データモデル：`docs/DATA_MODEL.md`
- 計画・進捗・未決定事項：`docs/IMPLEMENTATION_PLAN.md`

利用者はプログラミングの専門家ではない。説明は日本語で、平易に、要点を短く。

## 実行前に必ず利用者の確認を取ること

- 料金が発生しうる変更（Blaze プランが必要な機能、Cloud Functions、Cloud Storage for Firebase、有料 API 等）
- Firebase の課金プラン変更、Firebase へのデプロイ（Hosting / Rules）
- 大幅なアーキテクチャ変更（`docs/ARCHITECTURE.md` の方針を変えるもの）
- データ削除（Firestore のデータ、サンプル以外のファイル）
- Git 履歴を破壊する操作（force push、`reset --hard`、公開済みコミットの rebase / amend）
- 秘密情報・認証情報に関する操作
- `git push`、Pull Request の作成

## 品質ゲート（各フェーズ終了時・コミット前）

```
npm run typecheck
npm run lint
npm test
npm run build
```

- すべて成功させる。失敗したら原因を調べて直す。
- **テスト・型チェック・lint を無効化／スキップ／緩めて通したことにしない**（`@ts-ignore`、`eslint-disable`、`any` への逃げ、テストの削除・`skip` を含む）。どうしても必要な場合は理由を利用者に説明する。
- Security Rules のテストは `npm run test:rules`（Firestore Emulator + Java が必要）。Rules を変更したら実行する。

## アーキテクチャのルール

- 依存方向：`pages/components/hooks → services → lib/fsrs, repositories(interface) → domain`。
- **`ts-fsrs` を import してよいのは `src/lib/fsrs/` だけ。** 外からは `src/lib/fsrs/index.ts`（公開 API）だけを使う。ts-fsrs の型・enum を外に出さない。
- ts-fsrs のバージョンは 5.4.2 に固定している。上げる場合は利用者に確認し、`scheduler.test.ts` のバージョン確認テストと docs を更新する（SchedulerConfig の id が変わり、新しい設定記録が作られる）。
- 正式なレビュー日時は「評価ボタンを押した時刻」。次回予定の preview は参考値で、保存時にその時刻で計算し直す。
- 時刻に依存する処理は `now` を引数で受け取る（UI では `useClock()`）。`new Date()` を services / domain 内で直接呼ばない。
- **`firebase/*` を import してよいのは `src/services/firebase/` と `src/repositories/firestore/` だけ。** `src/services/firebase/` を import してよいのは `src/main.tsx`（アプリの組み立て）だけ。画面・フック・サービスは `AuthGateway` / `AppUser`（`src/services/auth/`）とリポジトリの interface を使う。
- アプリ画面での Owner 判定は UX であり、セキュリティの境界ではない。データの保護は Firestore Security Rules で行う（Rules なしで Firestore を使わない）。
- 認証まわりのテストは偽の AuthGateway（`src/test/fakeAuth.ts`）を使い、Firebase と実際に通信するテストを作らない。
- `src/domain/` は同じディレクトリ内のファイル以外を import しない純粋な TypeScript にする（ts-fsrs・Firebase・React の型も使わない。日時は `Date`）。`lib/`・`services/`・`repositories/` も React に依存させない。これらは ESLint で強制している。
- 評価は `ReviewRating`（'again' | 'hard' | 'good' | 'easy'）、FSRS の状態は `SchedulingSnapshot` などのドメイン型で扱う。ts-fsrs の型・enum との変換は `src/lib/fsrs/` だけで行う。
- データ層は `src/repositories/types.ts` の interface 経由で使う。interface を変えたらメモリ実装とテストも合わせて更新する。
- FSRS の計算を UI コンポーネントに書かない。FSRS アルゴリズムを独自実装しない。
- **Card（教材）と ReviewState（FSRS 状態）と ReviewLog（履歴）は別ドキュメント。** Card の作成・更新・インポートで ReviewState / ReviewLog を変更・削除するコードを書かない。
- ReviewLog は追記のみ（更新・削除しない）。ReviewState・ReviewLog・集計（progress）は 1 つの batch でアトミックに保存する。ReviewLog には previousState / nextState の FSRS スナップショットと `scheduler`（設定 id・ライブラリのバージョン）を必ず入れる。
- 画面表示のために教材の全 Card・全 ReviewState・全 ReviewLog を読み込むコードを書かない（例外：利用者が明示的に実行する「再集計」）。必要な分だけをクエリする（`docs/DATA_MODEL.md` §3）。
- 削除は原則しない。カードは `isArchived` でアーカイブする。
- 教材名・カテゴリー名などをコードにハードコードしない（サンプルデータ・テストは除く）。
- `Card.examDifficulty`（問題そのものの難易度）と `ReviewState.difficulty`（FSRS 内部値）を混同しない。Card に `difficulty` という名前のフィールドを作らない。
- 統計で「正答率」という語を使わない（自己評価の割合と FSRS 内部値を区別する）。
- Firestore の読み書きを増やす変更をするときは、無料枠（読み取り 5万/日・書き込み 2万/日）への影響を考え、必要なら説明する。

## UI のルール

- 日本語 UI、mobile-first、片手操作。評価ボタン（Again / Hard / Good / Easy）は画面下部に大きく。
- Deck / Note Type / Field / スケジューラー内部状態などの内部構造を利用者に見せない。
- 装飾より、読みやすさ・操作の速さ・迷わなさを優先。UI ライブラリ・CSS フレームワークは導入しない（CSS 変数 + CSS Modules）。
- エラーは日本語で表示し、アプリ全体を落とさない（Error Boundary、`AppError` への変換）。

## ライブラリ

- 新しいライブラリを追加する前に、本当に必要か検討する。追加したら `docs/ARCHITECTURE.md` の表を更新する。
- ライブラリの API は記憶に頼らず、インストールされたバージョンの型定義（`node_modules/<pkg>/dist/*.d.ts`）または公式ドキュメントで確認する。
- ts-fsrs の deprecated API（例：`elapsed_days`）への依存は `src/lib/fsrs/` 内に閉じ込める。

## 秘密情報

- `.env`, `.env.local`, `.env.*.local`、サービスアカウント JSON、秘密鍵、トークンをコミットしない。
- 環境変数を追加したら `.env.example` にキー名だけ追記する（値は書かない）。
- `firestore.rules` は `.env.local` の `VITE_OWNER_UID` から生成する生成物でありコミットしない。編集するのは `firestore.rules.template`。
- `.env.local` の値（Firebase の設定・UID）をログ・コミット・報告に出力しない。必要なら変数名だけを扱う。
- コミット前に `git diff --staged` で秘密情報が含まれていないか確認する。

## Git

- 作業は `feature/<name>` ブランチで行い、フェーズ完了時に PR で `main` へマージする（push / PR 作成は確認後）。
- コミットメッセージは簡潔な英語の Conventional Commits（`feat:`, `fix:`, `test:`, `docs:`, `chore:`, `refactor:`）。
- 1 コミット = 1 つの意味のある変更。生成物・無関係な変更を混ぜない。

## テスト

- FSRS 関連（スケジュール計算、ReviewState 更新、ReviewLog 生成、新規/期限判定、学習キュー）には必ずユニットテストを書く。
- インポート（CSV/JSON パース、検証、重複、更新時の履歴保持）にもテストを書く。
- 時刻に依存するテストは固定日時を注入する（services には `now` を渡し、画面のテストは `src/test/renderApp.tsx` の `createTestClock` を使う）。

## ドキュメント

- 設計や方針を変えたら該当する `docs/*.md` を同じ PR で更新する。
- フェーズ完了時に `docs/IMPLEMENTATION_PLAN.md` の進捗（✅）と未決定事項を更新する。
- 開発用データはダミーのみ。本物の検定問題を大量に作らない。
