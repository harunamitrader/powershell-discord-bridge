# Discord Bridge Cron — 仕様書

## 概要

powershell-discord-bridge のターミナルスロットに対して、cron スケジュールで自動的にテキストを送信する機能。

2 コンポーネント構成：

| コンポーネント | 場所 | 役割 |
|--------------|------|------|
| **Cron Daemon** | powershell-discord-bridge 内蔵 | スケジュール管理・実行 |
| **Cron TUI** | 同梱サブディレクトリ `bridge-cron-tui\` | ジョブ設定管理 |

---

## アーキテクチャ

```
bridge-cron-tui（Node.js TUI）
    ↓ JSON ファイルの読み書き
CRON_JOBS_DIR  <repo>\cron-jobs\
    ↑ chokidar でファイル監視（ホットリロード）
powershell-discord-bridge（Electron）
    └── CronJobScheduler
        └── node-cron 発火 → TerminalAutomationService.sendInput()
```

- TUI と Daemon はファイルシステム経由で疎結合
- Daemon は Bridge の起動・終了と同じライフサイクル
- TUI は任意のターミナルで起動・終了可能（スロット占有は操作時のみ）

---

## ジョブファイル仕様

### 保存場所

```
cron-jobs\{name}.json
```

例: `C:\Users\sgmxk\Desktop\AI\repos\github\harunamitrader\powershell-discord-bridge\cron-jobs\morning-task.json`

### ファイル形式

```json
{
  "name": "morning-task",
  "cron": "0 9 * * *",
  "slot": 2,
  "text": "python analyze.py",
  "timezone": "Asia/Tokyo",
  "active": true
}
```

| フィールド | 型 | 必須 | 説明 |
|-----------|-----|------|------|
| `name` | string | ✓ | ジョブ識別名。ファイル名（拡張子なし）と一致させる |
| `cron` | string | ✓ | 5 フィールド cron 式（分 時 日 月 曜） |
| `slot` | 1\|2\|3\|4\|5\|6 | ✓ | 送信先ターミナルスロット番号 |
| `text` | string | ✓ | スロットに送信する本文テキスト（実行時に `[from: cron]` ヘッダーを自動付与） |
| `timezone` | string | — | タイムゾーン（デフォルト: `Asia/Tokyo`） |
| `active` | boolean | — | `false` でジョブ停止（デフォルト: `true`） |

### cron 式の例

| 式 | 説明 |
|----|------|
| `0 9 * * *` | 毎日 09:00 |
| `0 10 * * 1` | 毎週月曜 10:00 |
| `30 8,20 * * *` | 毎日 8:30 と 20:30 |
| `0 */6 * * *` | 6 時間ごと |

---

## Bridge 側仕様（powershell-discord-bridge）

### 追加ファイル

```
src/main/cron/cronJobScheduler.ts
```

### CronJobScheduler クラス

```typescript
export class CronJobScheduler {
  constructor(
    private readonly terminalAutomationService: TerminalAutomationService,
    private readonly terminalSlotService: TerminalSlotService,
    private readonly appLogStore?: AppLogStore
  )

  start(): void   // Bridge 起動時に呼ぶ
  stop(): void    // Bridge 終了時に呼ぶ
}
```

### 動作

1. 起動時に `CRON_JOBS_DIR` を作成（なければ）
2. `chokidar` で `CRON_JOBS_DIR/*.json` を監視
3. ファイル追加・変更 → `registerJob()`: JSON を読んでタスク再登録
4. ファイル削除 → `unregisterJob()`: タスク停止・削除
5. cron 発火時 → `terminalSlotService.ensureSession(slot)` → `[from: cron]` ヘッダー付きに整形 → `terminalAutomationService.sendInput()`
6. エラー時はコンソールログを出力してスキップ（クラッシュしない）

### index.ts への組み込み

`bootstrap()` 内で `localAutomation.start()` の直後に追加：

```typescript
const cronJobScheduler = new CronJobScheduler(terminalAutomationService, terminalSlotService, appLogStore);
cronJobScheduler.start();
```

app 終了時（`app.on('before-quit')`）に `cronJobScheduler.stop()` を呼ぶ。

### 追加依存パッケージ

```json
"node-cron": "^3.0.3",
"chokidar": "^5.0.0"
```

型定義（devDependencies）：
```json
"@types/node-cron": "^3.0.11"
```

---

## TUI 側仕様（bridge-cron-tui）

### 同梱場所

```
C:\Users\sgmxk\Desktop\AI\repos\github\harunamitrader\powershell-discord-bridge\bridge-cron-tui
```

### 起動コマンド

```
Set-Location .\bridge-cron-tui
npm install
npm start
```

または、ルートから:

```
npm run cron:tui:install
npm run cron:tui:start
```

### プロジェクト構成

```
powershell-discord-bridge/
└── bridge-cron-tui/
    ├── package.json
    ├── src/
    │   ├── index.js         # エントリポイント（Ink renderApp）
    │   ├── App.js           # ジョブ一覧メイン画面
    │   ├── JobForm.js       # 追加・編集フォーム
    │   ├── jobStore.js      # JSON CRUD（CRON_JOBS_DIR 操作）
    │   └── cronUtils.js     # cron 式バリデーション・次回実行時刻計算
    └── .env.example         # CRON_JOBS_DIR のオーバーライド用（任意）
```

### CRON_JOBS_DIR の解決順

1. 環境変数 `CRON_JOBS_DIR` が設定されていればそれを使う
2. Bridge 側デフォルト: `path.join(app.getAppPath(), 'cron-jobs')`
3. TUI 側デフォルト: `path.join(__dirname, '../../cron-jobs')`

どちらも既定では、リポジトリ直下の `cron-jobs\` を指す。

### TUI 画面仕様

#### メイン画面（App.js）

```
┌─ Discord Bridge Cron ────────────────────────────────┐
│ ジョブ一覧                               2026-05-20   │
│ ─────────────────────────────────────────────────── │
│ ▶ [✓] morning-task    0 9 * * *   slot:2  次: 09:00  │
│   [✓] weekly-report   0 10 * * 1  slot:1  次: 月10:00│
│   [ ] test-job        * * * * *   slot:3  (停止中)    │
│                                                       │
│ [A]追加  [E]編集  [D]削除  [Space]ON/OFF  [Q]終了      │
└───────────────────────────────────────────────────────┘
```

- 上下キーでジョブ選択
- `A`: 追加フォームへ
- `E`: 選択ジョブの編集フォームへ
- `D`: 削除確認後に削除
- `Space`: active トグル（即時ファイル書き込み）
- `Q`: 終了

#### 追加・編集フォーム（JobForm.js）

```
┌─ ジョブ追加 ────────────────────────────────────────┐
│ name:     [morning-task              ]               │
│ cron:     [0 9 * * *                 ] ✓ 毎日09:00  │
│ slot:     [2] (1/2/3/4/5/6)                          │
│ text:     [python analyze.py         ]               │
│ timezone: [Asia/Tokyo                ]               │
│ active:   [✓]                                        │
│                                                       │
│ [Enter]保存  [Esc]キャンセル                          │
└───────────────────────────────────────────────────────┘
```

- `cron` フィールドは入力中にリアルタイムバリデーション
- 有効な cron 式の場合は次回実行時刻を横に表示
- `slot` は 1〜6 のみ受け付ける

### 依存パッケージ（TUI）

```json
{
  "type": "module",
  "dependencies": {
    "ink": "^5.1.0",
    "ink-text-input": "^6.0.0",
    "node-cron": "^3.0.3",
    "cronstrue": "^2.50.0"
  }
}
```

- `ink`: React ベースの TUI フレームワーク
- `ink-text-input`: テキスト入力コンポーネント
- `node-cron`: cron 式バリデーション（`cron.validate(expr)`）
- `cronstrue`: cron 式を人間が読める日本語に変換

---

## エラー処理方針

| 状況 | 動作 |
|------|------|
| ジョブ JSON が壊れている | パースエラーをログ出力してスキップ |
| 無効な cron 式 | ログ出力してスキップ |
| 指定スロットが存在しない | エラーをログ出力してスキップ |
| Bridge 未起動時に TUI 使用 | 問題なし（ファイル操作のみ） |

---

## 制約

- cron 式は 5 フィールド（秒指定なし）のみサポート
- `text` にキー操作（`!enter` 等）は含めない。テキストのみ送信し、実行時には `[from: cron]` ヘッダーが自動付与される
- `active: false` のジョブはデーモン起動時・ファイル変更時に無視される
