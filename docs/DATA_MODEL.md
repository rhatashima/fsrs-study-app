# データモデル (DATA_MODEL)

最終更新: 2026-10-05 / Phase 2
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
- **ドメイン型は ts-fsrs に依存しない。** 評価・学習段階・FSRS の状態はアプリ側の型で表し、ts-fsrs の型（`Card`, `Rating`, `State` など）との変換は `src/lib/fsrs/` のアダプター（Phase 3）が行う。
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
  id: string                                  // クライアントで採番し、ReviewState.lastLogId に入れる
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

- 集計の意味は純粋関数で定義する：レビュー時の加算は `applyReview`、全件からの作り直しは `rebuildProgress`。Firestore 実装（Phase 5）は `applyReview` と同じ加算を `increment()` で行う。
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
| enableFuzz | boolean | true | |
| fsrsWeights | number[] \| null | null | null ならライブラリの既定値 |
| learningSteps / relearningSteps | StepDuration[] \| null | null | null ならライブラリの既定値 |
| activeSchedulerConfigId | string \| null | null | |
| lastMaterialId | string \| null | null | |
| updatedAt | Date | | |

FSRS パラメータは全教材共通。新規カード数のみ教材ごと。null の項目の既定値は `src/lib/fsrs/` が ts-fsrs から解決する（ドメイン層はライブラリの既定値を知らない）。

## 3. 画面ごとの読み取り

| 場面 | クエリ | 読み取り数の目安 |
|---|---|---|
| 起動 | `settings/app`、教材一覧 | 1 + 教材数 |
| ホーム | `progress/summary` 1 件、期限カード数は `count()` 集計（`suspended == false && due <= 今日の終わり`） | 2〜3 |
| 学習開始：復習 | `reviewStates where suspended == false && due <= 今 orderBy due limit 100`、対応する Card を id で取得（`in` 最大 30 件ずつ） | 期限カード数 × 2 |
| 学習開始：新規 | `cards where isArchived == false && order > newCursorOrder orderBy order limit (残り新規数)`、念のため対応 ReviewState の有無を id で確認 | 新規数 × 2 程度 |
| 1 レビュー保存 | batch：ReviewState set + ReviewLog create + progress increment | 書き込み 3 |
| 統計 | `progress/summary` 1 件 | 1 |
| カード一覧 | `cards orderBy order limit 50`（ページング） | 50 / ページ |
| インポート | ファイル内 id の Card を取得して差分判定 | ファイル行数 |
| 再集計（手動） | 全 Card + 全 ReviewState | カード数 × 2 |
| 状態の復元（欠落時のみ） | `reviewLogs where cardId == x orderBy reviewedAt desc limit 1` | 1 |

ReviewLog は統計表示のために読まない。

### 新規カードの選び方
- `newCursorOrder` より大きい `order` のカードを順に取得する。新規導入したら `newCursorOrder` をそのカードの `order` に進める。
- 新しく追加されたカードは常に最大の `order` を採番されるため、カーソルより後ろに入り、取りこぼさない。
- 端末間の同時操作などでカーソルがずれても、取得時に ReviewState の有無を確認するので、学習済みカードを新規として出すことはない。

## 4. インポート形式

### CSV（UTF-8、1行目はヘッダー）

```csv
id,question,answer,explanation,category,subcategory,tags,examDifficulty,importance,imageUrl,source,notes
castle-001,天守の最上階を何という？,最上重,…,天守,,天守;用語,2,3,,,
```

- 必須列：`id, question, answer`。その他は省略可。
- 難易度の列名は `examDifficulty`。AI 生成ファイルとの互換のため `difficulty` 列も受け付け、取り込み時に `examDifficulty` として扱う（プレビューでその旨を表示）。
- `tags` はセミコロン `;` 区切り。`examDifficulty` / `importance` は 1〜5 の整数または空。
- BOM 付き UTF-8 も受け付ける。

### JSON

```json
{ "cards": [ { "id": "castle-001", "question": "…", "answer": "…", "tags": ["天守"], "examDifficulty": 2 } ] }
```
配列だけ（`[ {...}, ... ]`）も可。`tags` は配列または `;` 区切り文字列。

### 取り込み処理

1. パース → zod で行ごとに検証 → エラーを行番号付きで列挙。ファイル内の id 重複もエラー。
2. ファイル内の id について既存 Card を取得し、**新規 / 更新（差分あり）/ 変更なし** に分類してプレビュー。
3. 利用者が既存カードを「更新する／スキップする」を選んで確定。
4. Card と `progress/summary` の件数のみを書き込む（500 件ごとの batch）。既存カードの `createdAt`・`order` は維持。**ReviewState / ReviewLog には触れない。**
5. ファイルに含まれない既存カードは何もしない。

## 5. Security Rules（概略）

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    function isOwner(uid) {
      return request.auth != null && request.auth.uid == uid && uid == '__OWNER_UID__';  // build-rules.mjs が置換
    }
    match /users/{uid} {
      match /settings/{doc}                      { allow read, create, update: if isOwner(uid); }
      match /schedulerConfigs/{c}                { allow read, create: if isOwner(uid); }   // 不変
      match /materials/{m}                       { allow read, create, update: if isOwner(uid); }
      match /materials/{m}/cards/{c}             { allow read, create, update: if isOwner(uid); }
      match /materials/{m}/reviewStates/{c}      { allow read, create, update: if isOwner(uid); }
      match /materials/{m}/reviewLogs/{l}        { allow read, create: if isOwner(uid); }   // 追記のみ
      match /materials/{m}/progress/{p}          { allow read, create, update: if isOwner(uid); }
      match /materials/{m}/examSessions/{e}      { allow read, create: if isOwner(uid); }
    }
  }
}
```

delete はすべて禁止。ReviewLog の `rating` が again / hard / good / easy のいずれかであることなど、最低限のフィールド検証を Phase 5 で追加する。

## 6. インデックス（`firestore.indexes.json`）

| コレクション | フィールド | 用途 |
|---|---|---|
| reviewStates | suspended ASC, due ASC | 期限到来カードの取得・件数 |
| cards | isArchived ASC, order ASC | 新規カードの取得 |
| reviewLogs | cardId ASC, reviewedAt DESC | 欠落時の状態復元、カード別履歴 |
