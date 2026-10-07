# データモデル (DATA_MODEL)

最終更新: 2026-10-06 / Phase 5
対象 ts-fsrs バージョン: 5.4.2

## 0. 設計の原則

1. **教材（Card）・FSRS 状態（ReviewState）・履歴（ReviewLog）・集計（MaterialProgress）を別ドキュメントにする。**
2. **ReviewLog が真実の記録。** ReviewState は「最新の ReviewLog のスナップショット」と一致するキャッシュで、いつでも ReviewLog から復元できる。
3. **画面を開くたびに全件読み込みをしない。** ホーム・学習開始・統計は「必要な分だけのクエリ」「集計ドキュメント 1 件」「count() 集計」で表示する。

## 1. Firestore コレクション構成

```
users/{uid}
  ├─ settings/app                               … AppSettings（1ドキュメント）
  ├─ schedulerConfigs/{configId}                … SchedulerConfig（FSRS 設定のスナップショット。作成のみ・不変）
  └─ materials/{materialId}                     … StudyMaterial（教材のメタ情報）
       ├─ cards/{cardId}                        … Card（教材の中身）
       ├─ reviewStates/{cardId}                 … ReviewState（FSRS 状態。Card と同じ id）
       ├─ reviewLogs/{autoId}                   … ReviewLog（追記のみ）
       ├─ progress/summary                      … MaterialProgress（集計・新規カードの進捗。1ドキュメント）
       └─ examSessions/{autoId}                 … （将来）模擬試験の結果
```

- `cards` と `reviewStates` は**別コレクション・同じ id**。インポートで Card を上書きしても ReviewState は無関係。
- `progress/summary` は「学習の進み具合」を表す集計で、教材の内容（StudyMaterial）とは分ける。

## 2. 型定義

型の正本は `src/domain/` のコード。ここでは意味と制約を説明する。

- 日時はアプリ内では標準の `Date`。Firestore の `Timestamp` との変換は Phase 5 の Firestore リポジトリの converter で行う。
- **ドメイン型は ts-fsrs に依存しない。** 評価・学習段階・FSRS の状態はアプリ側の型で表し、ts-fsrs の型（`Card`, `Rating`, `State` など）との変換は `src/lib/fsrs/` のアダプターが行う（ts-fsrs 5.4.2）。
- Firestore にはドメイン型のフィールド名（camelCase）のまま保存する。

### StudyMaterial（`src/domain/material.ts`）

| フィールド | 型 | 必須 | 説明 |
|---|---|---|---|
| id | string | ✓ | Firestore 自動 id（開発用データは `sample-castle-3` など固定 id） |
| title | string | ✓ | 例：日本城郭検定3級 |
| description | string | ✓ | 空文字可 |
| isActive | boolean | ✓ | false の教材はホームで選べない |
| newCardsPerDay | number | ✓ | 1 日の新規カード上限。初期値 10（`DEFAULT_NEW_CARDS_PER_DAY`） |
| createdAt / updatedAt | Date | ✓ | |

### Card（`src/domain/card.ts`。学習に関する値を一切持たない）

| フィールド | 型 | 必須 | 説明 |
|---|---|---|---|
| id | string | ✓ | インポートファイルの id。`^[A-Za-z0-9_-]{1,100}$`（`isValidCardId`） |
| materialId | string | ✓ | |
| question | string | ✓ | プレーンテキスト（改行可） |
| answer | string | ✓ | |
| explanation | string | ✓ | 空文字可 |
| category | string | ✓ | 空の場合は「未分類」として扱う（`categoryLabel`） |
| subcategory | string | | |
| tags | string[] | ✓ | 空配列可 |
| **examDifficulty** | `Level`（1〜5） | | **問題そのものの難易度**（作成者が付ける）。FSRS の difficulty とは無関係。Card に `difficulty` という名前の項目は作らない |
| importance | `Level`（1〜5） | | 重要度（作成者が付ける） |
| imageUrl | string | | https URL または `/images/...` |
| source | string | | 出典 |
| notes | string | | メモ |
| order | number | ✓ | 新規カードを出す順番（1 以上の整数）。新規作成時に「教材内の最大値 + 1」を採番し、更新時は変えない |
| isArchived | boolean | ✓ | true なら出題・集計の対象外。履歴は残る |
| createdAt / updatedAt | Date | ✓ | |

### ReviewRating（`src/domain/rating.ts`）

```ts
type ReviewRating = 'again' | 'hard' | 'good' | 'easy'
type RatingCounts = Record<ReviewRating, number>
```

ts-fsrs の `Rating`（数値 enum）とは `src/lib/fsrs/` で変換する。Firestore にも文字列のまま保存する。

### SchedulingSnapshot（`src/domain/scheduling.ts`。ある時点の FSRS の状態）

ReviewState の FSRS 部分と、ReviewLog の `previousState` / `nextState` で共通の型。

```ts
type LearningPhase = 'new' | 'learning' | 'review' | 'relearning'   // ts-fsrs の State に対応

interface SchedulingSnapshot {
  phase: LearningPhase
  due: Date                    // 次回の復習予定
  stability: number            // FSRS の安定度
  difficulty: number           // FSRS が計算する記憶の難易度（Card.examDifficulty とは別物）
  scheduledDays: number
  learningSteps: number        // 学習ステップの何段目か
  reps: number
  lapses: number
  lastReviewedAt: Date | null
}
```

ts-fsrs v5 の `Card` から、v6 で削除予定の `elapsed_days` を除いている（経過日数は `lastReviewedAt` から求められるため）。アダプターが必要に応じて補う。

### ReviewState（`src/domain/review.ts`。ドキュメント id = cardId）

```ts
interface ReviewState extends SchedulingSnapshot {   // ReviewState.difficulty = FSRS 内部の難易度
  cardId: string
  materialId: string
  suspended: boolean          // カードのアーカイブ時に true。期限到来の対象から外す
  firstReviewedAt: Date
  ratingCounts: RatingCounts  // このカードの評価回数（統計の再集計用）
  lastLogId: string           // この状態を作った ReviewLog の id
  schedulerConfigId: string   // この状態を計算した FSRS 設定
  updatedAt: Date
}
```

- **ReviewState が存在しない = 未学習（新規）カード**（`isUnstudied`）。新規カードのために空の ReviewState を作らない。
- 期限到来：`!suspended && due <= now`（`isDue`）。
- 不変条件：ReviewState の FSRS 部分 == `lastLogId` の ReviewLog の `nextState`（メモリ実装は保存時に検証する）。

### ReviewLog（`src/domain/review.ts`。追記のみ。すべての項目が readonly）

```ts
interface ReviewLog {
  id: string                                  // カードを画面に出したときにクライアントで 1 回だけ採番（保存の再試行でも同じ id）。ReviewState.lastLogId に入れる
  materialId: string
  cardId: string
  reviewedAt: Date
  rating: ReviewRating
  previousState: SchedulingSnapshot | null    // レビュー直前の状態。初回レビュー（新規カード）では null
  nextState: SchedulingSnapshot               // レビュー後の状態
  scheduler: { configId: string; library: string; libraryVersion: string }  // SchedulerRef
  durationMs: number | null                   // 表示から評価までの時間（分析用）
}
```

**なぜ previousState / nextState の完全なスナップショットを持つか**
- **復元**：ReviewState が欠落・破損しても、そのカードの最新 ReviewLog の `nextState` をコピーすれば当時の計算どおりに戻せる。再計算しないので、ライブラリのバージョンや設定に左右されない。
- **監査**：各レビューで「どの状態から、どの評価で、どの設定で、どの状態になったか」が 1 件で完結する。`previousState` は直前の ReviewLog の `nextState` と一致するはずなので、連鎖が途切れていないか検証できる。
- `scheduler` には設定 id に加えてライブラリ名とバージョンも入れる。SchedulerConfig ドキュメントを参照しなくても、どのバージョンで計算したかが分かる。
- サイズは 1 件あたり約 0.5〜1KB。1 日 100 レビューを 10 年続けても無料枠（1GiB）に収まる見込み。

**2 種類の「復元」を区別する**

| 方法 | 用途 | 結果 |
|---|---|---|
| スナップショット復元（最新 ReviewLog の `nextState` をコピー） | 欠落・破損からの復旧 | 当時の計算どおり |
| 再計算（ts-fsrs の `reschedule` に全 ReviewLog の `rating` と `reviewedAt` を渡す） | FSRS 設定の変更・最適化後に予定を引き直す（将来機能・利用者の明示操作のみ） | 現在の設定での計算結果 |

### SchedulerConfig（`src/domain/scheduling.ts`。`users/{uid}/schedulerConfigs/{id}`。作成のみ・不変）

```ts
interface SchedulerConfig {
  id: string               // schedulerConfigId() で生成：例 "ts-fsrs@5.4.2-1a2b3c4d"
  library: string          // "ts-fsrs"
  libraryVersion: string   // "5.4.2"
  params: FsrsParams       // すべての値が確定したパラメータ
  createdAt: Date
}

interface FsrsParams {
  requestRetention: number
  maximumInterval: number
  weights: number[]
  enableFuzz: boolean
  enableShortTerm: boolean
  learningSteps: StepDuration[]     // 例 ["1m", "10m"]
  relearningSteps: StepDuration[]
}
```

- id はライブラリ名・バージョン・パラメータのハッシュ（FNV-1a、暗号用途ではない）から決まる。設定を変えたときだけ新しい記録が 1 件増える。
- 起動時：現在の設定から id を計算し、`settings.activeSchedulerConfigId` と同じなら何もしない。違う場合だけ SchedulerConfig を作成して `settings` を更新する。

### MaterialProgress（`src/domain/progress.ts`。`materials/{m}/progress/summary`）

ホーム・統計を**このドキュメント 1 件の読み取り**で表示するための集計。

```ts
interface MaterialProgress {
  materialId: string
  totalCards: number            // アーカイブされていないカード数
  studiedCards: number          // 1 回以上学習したカード数（未学習数 = totalCards − studiedCards）
  newCursorOrder: number        // order がこの値以下のカードは新規導入を検討済み
  ratingCounts: RatingCounts    // 評価別の回数（総レビュー数はこの合計）
  byCategory: Record<string, { totalCards: number; studiedCards: number; ratingCounts: RatingCounts }>
  daily: Record<DayKey, { reviews: number; newCards: number }>   // 直近 30 日分
  lastReviewedAt: Date | null
  rebuiltAt: Date | null        // 最後に全件から作り直した日時
  updatedAt: Date
}
```

- 集計の意味は純粋関数で定義する：レビュー時の加算は `applyReview`、全件からの作り直しは `rebuildProgress`。Firestore 実装もトランザクション内で読み取った集計に `applyReview` を適用して書く（メモリ実装と同じ計算。同時更新はトランザクションのやり直しで解決）。
- `DayKey` は `"YYYY-MM-DD"`。設定の区切り時刻（初期値 4 時）より前は前日として扱う（`toDayKey`）。
- 今日の残り新規数：`remainingNewCardsToday(progress, newCardsPerDay, today)`。
- カードのカテゴリーを後から変えると、過去の評価回数は旧カテゴリーに残る。統計画面の「再集計」（`rebuildProgress`。全 Card + 全 ReviewState を読む。利用者が押したときだけ）で現在のカテゴリーに合わせる。
- `rebuildProgress` は、先頭から連続して学習済みのカードまで `newCursorOrder` を進める（間の未学習カードを取りこぼさない）。

### AppSettings（`src/domain/settings.ts`。`users/{uid}/settings/app`）

| フィールド | 型 | 初期値 | 説明 |
|---|---|---|---|
| dayStartHour | 0〜23 | 4 | 「今日」の区切り |
| requestRetention | number | 0.9 | 目標保持率 |
| maximumInterval | number | 36500 | 最大間隔（日） |
| enableFuzz | boolean | true | ts-fsrs の既定値（false）とは異なるため明示 |
| enableShortTerm | boolean | true | 学習ステップ（分・時間単位の再出題）を使う |
| learningSteps | StepDuration[] | ['1m', '10m'] | |
| relearningSteps | StepDuration[] | ['10m'] | |
| fsrsWeights | number[] \| null | null | null なら ts-fsrs 既定の重み（将来の最適化結果を保存） |
| activeSchedulerConfigId | string \| null | null | |
| lastMaterialId | string \| null | null | |
| updatedAt | Date | | |

FSRS パラメータは全教材共通。新規カード数のみ教材ごと。初期値は `DEFAULT_FSRS_SETTINGS` としてアプリ側で明示し、ライブラリの暗黙の既定値に頼らない（例外は重みの null）。ts-fsrs が正規化した後の実際の値は SchedulerConfig に記録される。

既存データに `enableShortTerm` などがない場合（将来 Firestore から古い設定を読んだ場合）は、Phase 5 の converter で初期値を補う。

## 3. 画面ごとの読み取り

| 場面 | クエリ | 読み取り数の目安 |
|---|---|---|
| 起動・ホーム（段 1） | `settings/app` ∥ 教材一覧（同時に読む） | 1 + 教材数 |
| ホーム（段 2） | `progress/summary` 1 件 ∥ `reviewStates where suspended == false && due < 学習日の終わり`（Review / 学習中を区別して数えるため状態を取得） | 1 + 今日の期限カード数 |
| 学習開始 | ホームから 60 秒以内なら段 1〜2 を再利用し、以下の段 3〜4 だけを読む（ARCHITECTURE.md「読み込みの段」） | — |
| 学習開始：復習・学習中 | `reviewStates where suspended == false && due < 学習日の終わり orderBy due`（Review の 1 日の上限なし）、対応する Card を id で取得（`in` 最大 30 件ずつ） | 期限カード数 × 2 |
| 学習開始：新規 | `cards where isArchived == false && order > newCursorOrder orderBy order limit (残り新規数)`、念のため対応 ReviewState の有無を id で確認 | 新規数 × 2 程度 |
| 1 レビュー保存 | トランザクション：ReviewLog・ReviewState・集計を読み、整合性を確かめてから 3 つを書く | 読み取り 3 + 書き込み 3（Rules の `existsAfter` で読み取り +1） |
| 新規カードの状態欠落チェック | `reviewLogs where cardId in [新規候補]`（通常 0 件） | 1 |
| 統計 | `progress/summary` 1 件 | 1 |
| カード一覧 | `cards orderBy order limit 50`（ページング） | 50 / ページ |
| インポート（プレビュー） | ファイル内 id の Card（30 件ずつ）+ order の最大値 1 件 | ファイル行数 + 1 |
| インポート（集計の作り直し） | 教材の全 Card + 全 ReviewState + 集計 | カード数 × 2 + 1 |
| 再集計（手動） | 全 Card + 全 ReviewState | カード数 × 2 |
| 状態の復元（利用者が選んだときだけ） | `reviewLogs where cardId == x orderBy reviewedAt desc`（評価回数を数え直すため、そのカードの履歴を読む） | そのカードのレビュー回数 |

ReviewLog は統計表示のために読まない。

### 新規カードの選び方
- `newCursorOrder` より大きい `order` のカードを順に取得する。新規導入したら `newCursorOrder` をそのカードの `order` に進める。
- 新しく追加されたカードは常に最大の `order` を採番されるため、カーソルより後ろに入り、取りこぼさない。
- 端末間の同時操作などでカーソルがずれても、取得時に ReviewState の有無を確認するので、学習済みカードを新規として出すことはない。

## 4. インポート形式（Phase 6）

教材画面で取り込み先の教材を選び、「問題をインポート」から CSV / JSON を取り込む。実装は `src/services/import/`、サンプルは `samples/import/`。

### CSV

- 文字コード UTF-8（BOM 付きも可）。カンマ区切り。1 行目は見出し（列名）。空行は無視する。
- 引用符（`"`）で囲めば、カンマ・改行・`""`（ダブルクォート 1 つ）を含められる（papaparse で読む）。
- 列の数が見出しと違う行・閉じていない引用符はエラー。位置は表計算ソフトの行番号（見出し = 1 行目）で示す。

```csv
id,question,answer,explanation,category,subcategory,tags,examDifficulty,importance,imageUrl,source,notes,order
castle-001,天守の最上階を何という？,最上重,"解説。
2 行目もある",天守,,天守;用語,2,3,,,,
```

### JSON

カードの配列（`[ {...}, ... ]`）。`{ "cards": [ ... ] }` も可。位置は「N 件目」で示す。

```json
[{ "id": "castle-001", "question": "…", "answer": "…", "tags": ["天守", "用語"], "examDifficulty": 2, "importance": 3 }]
```

### 項目

| 項目 | 必須 | 内容 |
|---|---|---|
| `id` | ✓ | 教材内で一意の id（`^[A-Za-z0-9_-]{1,100}$`）。同じ id は同じカードとして扱う |
| `question` / `answer` | ✓ | 空は不可 |
| `explanation` / `category` | | 空可（カテゴリーが空なら「未分類」） |
| `subcategory` / `source` / `notes` | | 空なら値なし |
| `tags` | | CSV は `;` 区切り。JSON は配列か `;` 区切り。前後の空白・空のタグ・重複を除く |
| `examDifficulty` | | 問題の難易度 1〜5 の整数。**互換用に `difficulty` も受け付け、`examDifficulty` として取り込む**（両方あるとエラー。Card に `difficulty` は作らない） |
| `importance` | | 重要度 1〜5 の整数 |
| `imageUrl` | | `https://` で始まる URL か `/` で始まるパス |
| `order` | | 新規カードの出題順（1 以上の整数） |
| `materialId` | | 不要。あれば選んだ教材と同じであること（違えばエラー。別の教材への誤投入を防ぐ） |

- 上記以外の列・項目は警告を出して無視する。1 回に取り込めるのは 5,000 件まで。

### 取り込みの流れ

1. **読み取り・正規化・検証**（保存しない）：上の規則と、ファイル内の id の重複（エラーのある行も含めて）を調べる。**エラーが 1 件でもあれば何も保存しない**。何行目（何件目）の何が問題かを日本語で表示する。
2. **既存カードとの比較（プレビュー）**：ファイル内の id のカードと教材内の order の最大値だけを読み、各行を分類する。
   - **新規**：order がなければ、教材内の最大値（とファイル内で指定された order の最大値）の後ろにファイルの順で採番。作成・更新日時は取り込み時刻。
   - **更新**：ファイルに含まれていた項目だけを重ね、内容が変わるもの。更新日時だけを取り込み時刻にする（作成日時・並び順・アーカイブの状態は変えない。order の指定があればその値）。
   - **変更なし**：内容が同じもの。保存しない（更新日時も変えない）。
   - ファイルに**含まれていない項目**（列・キーがない）は既存の値を残す。含まれていて空の項目は値を消す。
   - 件数（新規・更新・変更なし・エラー・合計）と、更新の例（何が変わるか）を表示する。
3. **保存**：新規・更新のカードだけを 400 件ずつ順番に保存する（Firestore の一括書き込みの上限 500 件に余裕を残す）。進捗を「n / 合計 件」で表示する。
4. **集計の作り直し**：すべて保存できたら、教材の全カード・全 ReviewState から MaterialProgress を作り直す（`rebuildProgress`。日別の記録は引き継ぐ）。カテゴリーの変更なども正しく反映される。全件を読むが、インポート時だけ。

### 守ること

- 変更するのは Card だけ。**ReviewState・ReviewLog・SchedulerConfig には触れない**（学習済みのカードの本文を直しても学習履歴と FSRS の状態はそのまま）。
- ファイルにない既存カードは**削除しない**（削除は使わない。Security Rules でも禁止）。
- **途中で失敗した場合**：保存済みの分は戻さない。同じファイルをもう一度取り込むと、保存済みの分は「変更なし」になり、残りだけが保存される（冪等）。画面で「同じファイルをもう一度取り込むことで続行できます」と知らせる。
- **集計の作り直しだけ失敗した場合**：カードは戻さず「カードの取り込みは完了しましたが、集計の再作成に失敗しました」と表示し、「集計を作り直す」でやり直せる。

## 5. Security Rules

正本は `firestore.rules.template`（デプロイする `firestore.rules` は `npm run firebase:prepare` が `.env.local` の `VITE_OWNER_UID` を埋め込んで生成し、Git には入れない）。テストは `tests/rules/firestore.rules.test.ts`（Firestore Emulator）。

| パス | read | create | update | delete | 主な検証 |
|---|---|---|---|---|---|
| `users/{uid}/settings/app` | Owner | Owner | Owner | ✕ | id が `app`、区切り時刻 0〜23、保持率 0〜1 など |
| `users/{uid}/schedulerConfigs/{id}` | Owner | Owner | ✕（不変） | ✕ | `id` がドキュメント id と一致 |
| `users/{uid}/materials/{m}` | Owner | Owner | Owner | ✕ | `id` 一致、タイトル・日時の型 |
| `…/cards/{c}` | Owner | Owner | Owner | ✕ | `id`・`materialId` 一致、order ≥ 1、難易度・重要度 1〜5 |
| `…/reviewStates/{c}` | Owner | Owner | Owner | ✕ | `cardId`・`materialId` 一致、FSRS 値の型、**`lastLogId` の ReviewLog が書き込み後に存在すること（`existsAfter`）** |
| `…/reviewLogs/{l}` | Owner | Owner | **✕（追記のみ）** | **✕** | `id` 一致、評価が 4 種のいずれか、nextState の型、想定外の項目なし |
| `…/progress/summary` | Owner | Owner | Owner | ✕ | id が `summary`、件数が 0 以上の整数 |
| 上記以外 | ✕ | ✕ | ✕ | ✕ | 不明なコレクションはすべて拒否 |

- Owner ＝ `request.auth.uid == {uid}` かつ `{uid}` が Owner の UID。クライアントの `VITE_OWNER_UID` は信用せず、Rules に埋め込んだ UID と Firebase Authentication の UID で判定する。
- 未ログイン・Owner 以外は、自分の UID の下も含めてすべて拒否。
- 細かな整合性（ReviewState の値が ReviewLog の nextState と一致する等）はアプリ側（トランザクション内の検査）で守る。Rules は型と不変条件（追記のみ・削除禁止・状態は履歴とセット）を守る。

### アプリ側の検証（`src/repositories/firestore/validation.ts`）

Firestore から読んだデータは型注釈を信用せず、必須項目・型・Timestamp・列挙値を確かめてからドメイン型にする（手書きの小さな検証。ライブラリは追加しない）。

- 形式が正しくない ReviewState は `CorruptedReviewStateError` にする（黙って除外・修復しない）。
- ReviewLog があるのに ReviewState がない新規候補も `CorruptedReviewStateError`（新規として学習すると履歴とつながらない状態で上書きしてしまうため）。
- 復元は利用者が「学習履歴から復元する」を選んだときだけ：そのカードの有効な ReviewLog のうち最新の `nextState` を ReviewState にし、評価回数と初回日時は履歴から数え直す（再計算はしない）。ReviewLog と集計は変えない。
- 形式が正しくない ReviewLog は、履歴の一覧（復元の材料）に含めない。
- 古い形式の設定は、足りない項目を初期値で補う。

### レビュー保存の原子性と二重登録の防止

- 1 回のレビューは Firestore のトランザクションで保存する：ReviewLog（同じ id）・ReviewState・集計を読み、`decideReviewWrite` で判定してから 3 つを書く。途中までだけ保存されることはない。
- 同じ id・同じ内容の ReviewLog がすでにある（通信の再試行・二重送信）→ 何もせず成功。集計も二重に加算されない。
- 同じ id で内容が違う、または保存済みの ReviewState が `previousState` と違う（別の端末で先に学習した）→ `conflict`。
- 集計は読み取った値に `applyReview`（メモリ実装と同じ関数）を適用して書く。同時更新はトランザクションのやり直しで解決される。
- 画面では、評価後すぐ次の問題を表示し、保存は裏で行う。保存待ちは最大 1 件で、前の回答の保存が終わるまで次の評価はできない。保存に失敗したレビューは「もう一度保存する」で**同じ内容（同じ id・評価・日時・状態）**を再送する。競合したときは再送せず、最新の状態を読み込み直す（ARCHITECTURE.md「同期・保存方針」）。

## 6. インデックス（`firestore.indexes.json`）

Git で管理し、`firebase deploy --only firestore:indexes` で反映する（コンソールで手作業では作らない）。Firestore Emulator はインデックスの有無を確認しないため、本番で不足していれば `failed-precondition`（日本語の「データベースの設定（インデックスなど）が不足しています」）になる。


| コレクション | フィールド | 用途 |
|---|---|---|
| reviewStates | suspended ASC, due ASC | 期限到来カードの取得・件数 |
| cards | isArchived ASC, order ASC | 新規カードの取得 |
| reviewLogs | cardId ASC, reviewedAt DESC | 欠落時の状態復元、カード別履歴 |
