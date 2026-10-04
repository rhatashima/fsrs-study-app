# fsrs-study-app

事前に作成した問題を、FSRS（[ts-fsrs](https://github.com/open-spaced-repetition/ts-fsrs)）で計算したタイミングで復習する、個人用の汎用学習 Web アプリです。

- 最初の教材は「日本城郭検定3級」ですが、美術検定・歴史系検定など任意の教材を追加できる汎用的な構造にしています。
- 教材は CSV / JSON で一括登録し、PC とスマートフォン（PWA）の複数端末で同じ学習履歴を使います。
- 利用者は 1 名のみ（一般公開しません）。

> **現在開発中です（Phase 1：基本構成）。** 画面は骨組みのみで、学習機能・ログイン・データ保存はまだ動きません。進捗は [docs/IMPLEMENTATION_PLAN.md](docs/IMPLEMENTATION_PLAN.md) を参照してください。

## ドキュメント

| ファイル | 内容 |
|---|---|
| [docs/REQUIREMENTS.md](docs/REQUIREMENTS.md) | 要件 |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | 構成・レイヤーの責務 |
| [docs/DATA_MODEL.md](docs/DATA_MODEL.md) | Firestore のデータモデル |
| [docs/IMPLEMENTATION_PLAN.md](docs/IMPLEMENTATION_PLAN.md) | 開発フェーズ・Git 運用・決定事項 |
| [CLAUDE.md](CLAUDE.md) | Claude Code が守る開発ルール |

## 開発環境

- Node.js **22.22 以上**（推奨：24。`.nvmrc` あり）
- npm 10 以上

主な構成：React 19 / TypeScript 6.0 / Vite 8 / React Router 8 / Vitest 5 / ESLint 10

## セットアップ

```bash
git clone git@github.com:rhatashima/fsrs-study-app.git
cd fsrs-study-app
npm ci          # package-lock.json どおりに依存パッケージをインストール
```

## コマンド

| コマンド | 内容 |
|---|---|
| `npm run dev` | 開発サーバーを起動（http://localhost:5173）。スマホから確認する場合は `npm run dev -- --host` |
| `npm run typecheck` | TypeScript の型チェック |
| `npm run lint` | ESLint（警告も失敗扱い） |
| `npm run test` | ユニットテスト（Vitest）を 1 回実行。`npm run test:watch` で監視モード |
| `npm run build` | 型チェック後、本番用ファイルを `dist/` に出力 |
| `npm run preview` | `dist/` の内容をローカルで確認 |

変更をコミットする前に、`typecheck` / `lint` / `test` / `build` がすべて成功することを確認してください。

## 環境変数

`.env.example` を `.env.local` にコピーして値を設定します。`.env.local` は Git にコミットされません。
Phase 1 の時点では環境変数は不要です。

## Firebase の設定・デプロイ

後続の Phase で追加します（Phase 4：Authentication、Phase 5：Firestore・Security Rules・Hosting へのデプロイ）。
Firebase は無料の Spark プランの範囲で使う設計です。

## ディレクトリ構成（現時点）

```
src/
  app/          ルーティング・共通レイアウト
  components/   共通 UI 部品（タブバーなど）
  pages/        各画面（ホーム・学習・教材・成績・設定）
  styles/       全体のスタイル
  test/         テストの共通設定
tests/
  architecture/ レイヤー間の import 制限のテスト
```

FSRS（`src/lib/fsrs/`）、Firebase（`src/services/firebase/`、`src/repositories/firestore/`）などは各 Phase で追加します。詳しくは [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) を参照してください。
