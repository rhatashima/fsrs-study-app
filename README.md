# fsrs-study-app

事前に作成した問題を、FSRS（[ts-fsrs](https://github.com/open-spaced-repetition/ts-fsrs)）で計算したタイミングで復習する、個人用の汎用学習 Web アプリです。

- 最初の教材は「日本城郭検定3級」ですが、美術検定・歴史系検定など任意の教材を追加できる汎用的な構造にしています。
- 教材は CSV / JSON で一括登録し、PC とスマートフォン（PWA）の複数端末で同じ学習履歴を使います。
- 利用者は 1 名のみ（一般公開しません）。

> **現在開発中です（Phase 4：Firebase Authentication まで完了）。** Google アカウントでログインし、ダミーカードを使って FSRS（ts-fsrs 5.4.2）による学習ができます。データの保存（Firestore）はまだありません。**データはメモリ上だけにあり、再読み込み・ログアウトすると学習履歴は消えます。** 進捗は [docs/IMPLEMENTATION_PLAN.md](docs/IMPLEMENTATION_PLAN.md) を参照してください。

### 今できること（`.env.local` を設定して `npm run dev` で起動）

- ログイン：Google アカウント（許可した 1 アカウントのみ）。設定画面からログアウト
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
| `npm run dev` | 開発サーバーを起動（http://localhost:5173）。ログインには `.env.local` の設定が必要（下記） |
| `npm run typecheck` | TypeScript の型チェック |
| `npm run lint` | ESLint（警告も失敗扱い） |
| `npm run test` | ユニットテスト（Vitest）を 1 回実行。`npm run test:watch` で監視モード |
| `npm run build` | 型チェック後、本番用ファイルを `dist/` に出力 |
| `npm run preview` | `dist/` の内容をローカルで確認 |

変更をコミットする前に、`typecheck` / `lint` / `test` / `build` がすべて成功することを確認してください。

## 環境変数

`.env.example` を `.env.local` にコピーして値を設定します。`.env.local` は Git にコミットされません。

| 変数 | 必須 | 内容 |
|---|---|---|
| `VITE_FIREBASE_API_KEY` | ✓ | Firebase Web アプリの設定（apiKey） |
| `VITE_FIREBASE_AUTH_DOMAIN` | ✓ | 同（authDomain。例 `<project-id>.firebaseapp.com`） |
| `VITE_FIREBASE_PROJECT_ID` | ✓ | 同（projectId） |
| `VITE_FIREBASE_APP_ID` | ✓ | 同（appId） |
| `VITE_OWNER_UID` | | 利用を許可する自分の UID。未設定ならどのアカウントも利用できない |

必須の値がないと、アプリは「Firebase の設定が見つかりません」と表示し、不足している変数名を案内します（テスト・型チェック・ビルドは設定なしでも動きます）。
サービスアカウントの鍵や Admin SDK の秘密鍵は使いません。リポジトリに入れないでください。

## Firebase Authentication の設定

Firebase は無料の **Spark プラン**のまま使います（課金プランへの変更は不要です）。

1. **Firebase プロジェクトを作る**：[Firebase コンソール](https://console.firebase.google.com/) で「プロジェクトを追加」。Google アナリティクスは不要です。
2. **Web アプリを登録する**：プロジェクトの概要 →「アプリを追加」→ ウェブ（`</>`）。Firebase Hosting の設定はこの時点では不要です（Phase 5 で行います）。
3. **Google ログインを有効にする**：構築 → Authentication →「始める」→ Sign-in method → Google を有効にし、サポートメールを選んで保存。
4. **承認済みドメインを確認する**：Authentication → 設定 → 承認済みドメイン に `localhost` があることを確認します（ない場合は追加）。`<project-id>.firebaseapp.com` と `<project-id>.web.app` は最初から入っています。
5. **Web の設定を `.env.local` に書く**：プロジェクトの設定 → マイアプリ → SDK の設定と構成 →「構成」に表示される `apiKey` / `authDomain` / `projectId` / `appId` を、それぞれ `VITE_FIREBASE_*` に設定します。
6. **自分の UID を `VITE_OWNER_UID` に設定する**：`npm run dev` を起動して Google でログインすると、「このアカウントには利用権限がありません」の画面に自分の UID が表示されます（Authentication → ユーザー でも確認できます）。それを `VITE_OWNER_UID` に設定し、開発サーバーを再起動して再度ログインします。

> **Firestore はまだ作成しないでください。** Phase 5 で、ロケーション **asia-northeast1（東京）** に作成します（ロケーションは後から変更できません）。

### ログインの方式

| 環境 | 方式 |
|---|---|
| ローカル開発（localhost） | ポップアップ |
| PC のブラウザ | ポップアップ（ブロックされた場合はリダイレクトでやり直す） |
| スマートフォン・ホーム画面に追加した PWA | リダイレクト（ページ遷移） |

- スマホのブラウザから LAN 経由（`npm run dev -- --host`、`http://192.168...`）で開いた場合、そのアドレスは承認済みドメインではないためログインできません。スマホでのログインは、Phase 5 で Firebase Hosting にデプロイした後に確認します。
- 本番の最初のアクセス先は **`https://<project-id>.firebaseapp.com`** とします。`authDomain` と同じドメインなので、リダイレクト方式のログインがブラウザのサードパーティ Cookie 制限の影響を受けません。
- 将来 `https://<project-id>.web.app` やカスタムドメインで使う場合、リダイレクト方式のログインには `authDomain` をそのドメインに合わせる等の追加設定が必要になることがあります（[Firebase のドキュメント：signInWithRedirect のベストプラクティス](https://firebase.google.com/docs/auth/web/redirect-best-practices)）。

### セキュリティについて

アプリ画面での Owner 判定（`VITE_OWNER_UID`）は、**表示の制御（使い勝手）であり、セキュリティの境界ではありません**。ブラウザ上のコードは利用者が書き換えられるためです。データを本当に守るのは、Phase 5 で作成する **Firestore Security Rules**（Owner の UID 以外の読み書きをサーバー側で拒否する）です。

## Firebase のデプロイ

Phase 5 で追加します（Firestore・Security Rules・Hosting へのデプロイ）。

## ディレクトリ構成（現時点）

```
src/
  app/            ルーティング・共通レイアウト・データ層の受け渡し
  components/     共通 UI 部品（タブバーなど）
  pages/          各画面（ホーム・学習・教材・成績・設定）
  hooks/          画面の状態（学習セッションなど）
  services/auth/  認証の型（AppUser / AuthGateway）とログイン方式の判定
  services/firebase/  Firebase の初期化と Authentication（Firebase SDK を使うのはここだけ）
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

Firestore（`src/repositories/firestore/`）などは各 Phase で追加します。詳しくは [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) を参照してください。
