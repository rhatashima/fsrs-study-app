# データモデル (DATA_MODEL)

最終更新: 2026-10-04 / Phase 0（改訂 1）
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

日時はアプリ内では `Date`、Firestore では `Timestamp`（変換はリポジトリ層の converter）。

### StudyMaterial

| フィールド | 型 | 必須 | 説明 |
|---|---|---|---|
| id | string | ✓ | Firestore 自動 id |
| title | string | ✓ | 例：日本城郭検定3級 |
| description | string | ✓ | 空文字可 |
| isActive | boolean | ✓ | false の教材はホームで選べない |
| newCardsPerDay | number | ✓ | 初期値 10 |
| createdAt / updatedAt | Date | ✓ | |

### Card（教材の中身。学習に関する値を一切持たない）

| フィールド | 型 | 必須 | 説明 |
|---|---|---|---|
| id | string | ✓ | インポートファイルの id。`^[A-Za-z0-9_-]{1,100}$` |
| materialId | string | ✓ | |
| question | string | ✓ | プレーンテキスト（改行可） |
| answer | string | ✓ | |
| explanation | string | | 空文字可 |
| category | string | ✓ | 空の場合は「未分類」 |
| subcategory | string | | |
| tags | string[] | ✓ | 空配列可 |
| **examDifficulty** | 1〜5 の整数 | | **問題そのものの難易度**（作成者が付ける）。FSRS の difficulty とは無関係 |
| importance | 1〜5 の整数 | | 重要度（作成者が付ける） |
| imageUrl | string | | https URL または `/images/...` |
| source | string | | 出典 |
| notes | string | | メモ |
| order | number | ✓ | 新規カードの出題順。新規作成時に「教材内の最大値 + 1」を採番し、更新時は変えない |
| isArchived | boolean | ✓ | true なら出題・集計の対象外。履歴は残る |
| createdAt / updatedAt | Date | ✓ | |

### FsrsSnapshot（ts-fsrs 5.x の `Card` と同じ構成。ReviewState と ReviewLog で共通）

```ts
interface FsrsSnapshot {
  due: Date;
  stability: number;
  difficulty: number;        // FSRS 内部の難易度（Card.examDifficulty とは別物）
  elapsed_days: number;      // ts-fsrs v6 で削除予定。lib/fsrs 内でのみ参照する
  scheduled_days: number;
  learning_steps: number;
  reps: number;
  lapses: number;
  state: 0 | 1 | 2 | 3;      // New / Learning / Review / Relearning
  last_review: Date | null;
}
```

フィールド名は ts-fsrs と同じ snake_case で保存する。ライブラリへの受け渡しや将来の再計算ツールへの入力を単純にするため。

### ReviewState（ドキュメント id = cardId）

```ts
interface ReviewState extends FsrsSnapshot {   // FSRS の値はトップレベル（ReviewState.difficulty = FSRS 内部値）
  cardId: string;
  materialId: string;
  suspended: boolean;              // カードのアーカイブ時に true。期限クエリから除外するため
  firstReviewedAt: Date;
  counters: { again: number; hard: number; good: number; easy: number };  // 統計の再集計用
  lastLogId: string;               // この状態を作った ReviewLog の id（監査用）
  schedulerConfigId: string;       // この状態を計算した FSRS 設定
  updatedAt: Date;
}
```

- **ReviewState が存在しない = 未学習（新規）カード**。新規カードのために空の ReviewState を作らない。
- 不変条件：`ReviewState` の FSRS 値 == `reviewLogs/{lastLogId}.after`。

### ReviewLog（追記のみ。更新・削除しない）

```ts
interface ReviewLog {
  id: string;                      // Firestore 自動 id（クライアントで事前採番し、ReviewState.lastLogId に入れる）
  cardId: string;
  materialId: string;
  reviewedAt: Date;
  rating: 1 | 2 | 3 | 4;           // Again / Hard / Good / Easy
  durationMs: number | null;       // 表示から評価までの時間（分析用）
  before: FsrsSnapshot | null;     // レビュー直前の状態。新規カードなら null
  after: FsrsSnapshot;             // レビュー後の状態（完全なスナップショット）
  schedulerConfigId: string;       // 計算に使った FSRS 設定（ライブラリのバージョン + パラメータ）
}
```

**なぜ before / after の完全スナップショットを持つか**
- **復元**：ReviewState が欠落・破損しても、そのカードの最新 ReviewLog の `after` をコピーすれば、当時の計算結果どおりに戻せる。再計算は不要で、ライブラリのバージョンや設定に左右されない。
- **監査**：各レビューで「どの状態から、どの評価で、どの設定で、どの状態になったか」が 1 ドキュメントで完結する。`before` は直前の ReviewLog の `after` と一致するはずなので、連鎖が途切れていないか検証できる。
- サイズは 1 件あたり約 0.5〜1KB。1 日 100 レビューを 10 年続けても数百 MB 未満で、無料枠（1GiB）に収まる見込み。

**2 種類の「復元」を区別する**

| 方法 | 用途 | 結果 |
|---|---|---|
| スナップショット復元（最新 ReviewLog の `after` をコピー） | 欠落・破損からの復旧 | 当時の計算どおり |
| 再計算（ts-fsrs `reschedule` に全 ReviewLog の `rating` と `reviewedAt` を渡す） | FSRS パラメータ変更・最適化後に予定を引き直す（将来機能・利用者の明示操作のみ） | 現在の設定での計算結果 |

### SchedulerConfig（`users/{uid}/schedulerConfigs/{configId}`。作成のみ・不変）

```ts
interface SchedulerConfig {
  id: string;                      // `ts-fsrs@5.4.2-<パラメータのハッシュ8桁>`（決定的に生成）
  library: 'ts-fsrs';
  libraryVersion: string;          // 例 "5.4.2"
  params: {                        // generatorParameters() の結果をそのまま保存
    request_retention: number;
    maximum_interval: number;
    w: number[];
    enable_fuzz: boolean;
    enable_short_term: boolean;
    learning_steps: string[];
    relearning_steps: string[];
  };
  createdAt: Date;
}
```

- ReviewLog には `schedulerConfigId` だけを入れ、パラメータ本体を毎回コピーしない。
- 設定変更・ライブラリ更新のたびに新しい id のドキュメントが 1 つ増えるだけ。古い設定も残るので、過去のレビューがどの設定で計算されたかを後から追跡できる。
- 起動時：現在の設定から id を計算し、`settings.activeSchedulerConfigId` と同じなら何もしない。違う場合だけ SchedulerConfig を作成して `settings` を更新する（通常は追加の読み取りなし）。

### MaterialProgress（`materials/{m}/progress/summary`）

ホーム・統計を**このドキュメント 1 件の読み取り**で表示するための集計。

```ts
interface MaterialProgress {
  totalCards: number;              // アーカイブされていないカード数
  studiedCards: number;            // ReviewState を持つカード数（アーカイブ除く）
  newCursorOrder: number;          // ここまでの order のカードは新規導入を検討済み
  totals: { reviews: number; again: number; hard: number; good: number; easy: number };
  byCategory: { [category: string]: {
    totalCards: number; studiedCards: number;
    reviews: number; again: number; hard: number; good: number; easy: number;
  } };
  daily: { [dayKey: string]: { reviews: number; newCards: number } };  // 直近 30 日分だけ保持
  rebuiltAt: Date | null;          // 最後に全件から再集計した日時
  updatedAt: Date;
}
```

- レビュー時は `increment()` で加算するため、読み取り不要で、複数端末から同時に書いても数がずれない。
- インポート・アーカイブ時に `totalCards` とカテゴリー別の件数を増減する。
- カードのカテゴリーを後から変えると、過去のレビュー数は旧カテゴリーに残る。統計画面の「再集計」ボタン（全 Card + 全 ReviewState を読む。利用者が押したときだけ）で現在のカテゴリーに合わせて作り直す。`ReviewState.counters` はこの再集計のために持つ。

### AppSettings（`users/{uid}/settings/app`）

| フィールド | 型 | 初期値 | 説明 |
|---|---|---|---|
| dayStartHour | 0〜23 | 4 | 「今日」の区切り |
| requestRetention | number | 0.9 | 目標保持率 |
| maximumInterval | number | 36500 | 最大間隔（日） |
| enableFuzz | boolean | true | |
| learningSteps / relearningSteps | string[] | ts-fsrs 既定値 | |
| fsrsWeights | number[] \| null | null | null なら ts-fsrs 既定値 |
| activeSchedulerConfigId | string \| null | null | |
| lastMaterialId | string \| null | null | |
| updatedAt | Date | | |

FSRS パラメータは全教材共通。新規カード数のみ教材ごと。

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

delete はすべて禁止。ReviewLog の `rating` が 1〜4 であることなど、最低限のフィールド検証を Phase 5 で追加する。

## 6. インデックス（`firestore.indexes.json`）

| コレクション | フィールド | 用途 |
|---|---|---|
| reviewStates | suspended ASC, due ASC | 期限到来カードの取得・件数 |
| cards | isArchived ASC, order ASC | 新規カードの取得 |
| reviewLogs | cardId ASC, reviewedAt DESC | 欠落時の状態復元、カード別履歴 |
