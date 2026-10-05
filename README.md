# fsrs-study-app

事前に作成した問題を、FSRS（[ts-fsrs](https://github.com/open-spaced-repetition/ts-fsrs)）で計算したタイミングで復習する、個人用の汎用学習 Web アプリです。

- 最初の教材は「日本城郭検定3級」ですが、美術検定・歴史系検定など任意の教材を追加できる汎用的な構造にしています。
- 教材は CSV / JSON で一括登録し、PC とスマートフォン（PWA）の複数端末で同じ学習履歴を使います。
- 利用者は 1 名のみ（一般公開しません）。

> **現在開発中です（Phase 3：FSRS 学習フローまで完了）。** ダミーカードを使って、ブラウザ上で FSRS（ts-fsrs 5.4.2）による学習ができます。ログインとデータ保存（Firebase）はまだありません。**データはメモリ上だけにあり、再読み込みすると学習履歴は消えます。** 進捗は [docs/IMPLEMENTATION_PLAN.md](docs/IMPLEMENTATION_PLAN.md) を参照してください。

### 今できること（`npm run dev` で起動）

- ホーム：選択中の教材、今日の復習数・学習中で今出せる数・今日の新規数
- 学習：問題 → 「答えを見る」→ 正答・解説 → 忘れた / 難しい / 正解 / 簡単（Again / Hard / Good / Easy、それぞれの次回予定つき）→ 次の問題
- 画像付きの問題（ダミーの SVG）
- 学習中のカード（1 分後・10 分後に再出題）は時刻が来るまで出ない。復習カードは今日の学習日（4:00 区切り）内なら出る。復習の 1 日上限はなし、新規は教材ごとの上限（初期値 10 枚）まで

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

主な構成：React 19 / TypeScript 6.0 / Vite 8 / React Router 8 / ts-fsrs 5.4.2 / Vitest 5 / ESLint 10

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
  app/            ルーティング・共通レイアウト・データ層の受け渡し
  components/     共通 UI 部品（タブバーなど）
  pages/          各画面（ホーム・学習・教材・成績・設定）
  hooks/          画面の状態（学習セッションなど）
  domain/         データの型と純粋関数（外部ライブラリに依存しない。学習キューのルールもここ）
  lib/fsrs/       ts-fsrs との変換と FSRS スケジューラー（ts-fsrs を使うのはここだけ）
  services/       学習の流れ（セッション開始・評価の確定・ホームの件数）
  repositories/   データ層の interface（types.ts）とメモリ実装（memory/）
  dev/            開発用ダミーデータ
  styles/         全体のスタイル
  test/           テストの共通設定・テストデータ作成関数
public/images/samples/  ダミーデータ用の自作 SVG 画像
tests/
  architecture/   レイヤー間の import 制限のテスト
```

Firebase（`src/services/firebase/`、`src/repositories/firestore/`）などは各 Phase で追加します。詳しくは [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) を参照してください。
