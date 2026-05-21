# Discord Bridge Cron — 実装計画

仕様書: `docs/CRON-SPEC.md`

実装は 2 フェーズ。**Phase 1（Bridge 側）→ Phase 2（TUI 側）** の順で進めること。

---

## Phase 1: multicli-discord-bridge に CronJobScheduler を追加

### 対象リポジトリ
`C:\Users\sgmxk\Desktop\AI\repos\github\harunamitrader\multicli-discord-bridge`

---

### Step 1-1: 依存パッケージ追加

`package.json` の `dependencies` に追加：
```json
"node-cron": "^3.0.3",
"chokidar": "^5.0.0"
```

`devDependencies` に追加：
```json
"@types/node-cron": "^3.0.11"
```

その後 `npm install` を実行。

---

### Step 1-2: CronJobScheduler を作成

新規ファイルを作成：
`src/main/cron/cronJobScheduler.ts`

実装要件：

```typescript
import * as nodeCron from 'node-cron';
import chokidar from 'chokidar';
import { readFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { app } from 'electron';
import type { TerminalAutomationService } from '../bridge/terminalAutomationService';
import type { TerminalSlotService } from '../app/terminalSlotService';
import type { AppLogStore } from '../app/appLogStore';

const CRON_JOBS_DIR = process.env['CRON_JOBS_DIR'] ?? path.join(app.getAppPath(), 'cron-jobs');

interface CronJobConfig {
  name: string;
  cron: string;
  slot: 1 | 2 | 3 | 4;
  text: string;
  timezone?: string;
  active?: boolean;
}

export class CronJobScheduler {
  private readonly tasks = new Map<string, nodeCron.ScheduledTask>();
  private watcher?: chokidar.FSWatcher;

  constructor(
    private readonly terminalAutomationService: TerminalAutomationService,
    private readonly terminalSlotService: TerminalSlotService,
    private readonly appLogStore?: AppLogStore
  ) {}

  start(): void {
    mkdirSync(CRON_JOBS_DIR, { recursive: true });
    this.watcher = chokidar.watch(path.join(CRON_JOBS_DIR, '*.json'), {
      ignoreInitial: false,
      awaitWriteFinish: { stabilityThreshold: 300, pollInterval: 100 }
    });
    this.watcher.on('add', (filePath) => this.registerJob(filePath));
    this.watcher.on('change', (filePath) => this.registerJob(filePath));
    this.watcher.on('unlink', (filePath) => this.unregisterJob(filePath));
    this.log(`started dir=${CRON_JOBS_DIR}`);
  }

  stop(): void {
    for (const task of this.tasks.values()) {
      task.stop();
    }
    this.tasks.clear();
    void this.watcher?.close();
    this.log('stopped');
  }

  private registerJob(filePath: string): void {
    const name = path.basename(filePath, '.json');
    this.unregisterJob(filePath);

    let job: CronJobConfig;
    try {
      job = JSON.parse(readFileSync(filePath, 'utf-8')) as CronJobConfig;
    } catch (error) {
      this.log(`parse error name=${name} error=${String(error)}`);
      return;
    }

    if (job.active === false) {
      this.log(`skipped (inactive) name=${name}`);
      return;
    }

    if (!nodeCron.validate(job.cron)) {
      this.log(`invalid cron name=${name} cron=${job.cron}`);
      return;
    }

    if (![1, 2, 3, 4].includes(job.slot)) {
      this.log(`invalid slot name=${name} slot=${job.slot}`);
      return;
    }

    const task = nodeCron.schedule(
      job.cron,
      () => { void this.executeJob(job); },
      { timezone: job.timezone ?? 'Asia/Tokyo' }
    );

    this.tasks.set(name, task);
    this.log(`registered name=${name} cron=${job.cron} slot=${job.slot}`);
  }

  private unregisterJob(filePath: string): void {
    const name = path.basename(filePath, '.json');
    const existing = this.tasks.get(name);
    if (existing) {
      existing.stop();
      this.tasks.delete(name);
      this.log(`unregistered name=${name}`);
    }
  }

  private async executeJob(job: CronJobConfig): Promise<void> {
    this.log(`executing name=${job.name} slot=${job.slot}`);
    try {
      const session = this.terminalSlotService.ensureSession(job.slot);
      await this.terminalAutomationService.sendInput({
        sessionId: session.id,
        content: job.text,
        appendEnter: true,
        source: 'automation'
      });
      this.log(`done name=${job.name} slot=${job.slot}`);
    } catch (error) {
      this.log(`failed name=${job.name} slot=${job.slot} error=${String(error)}`);
    }
  }

  private log(message: string): void {
    const line = `[cron] ${message}\n`;
    console.log(line.trimEnd());
    this.appLogStore?.appendMessage('stdout', line);
  }
}
```

---

### Step 1-3: index.ts に組み込み

`src/main/index.ts` を以下の通り修正：

**import を追加**（既存 import の末尾に）：
```typescript
import { CronJobScheduler } from './cron/cronJobScheduler';
```

**変数宣言を追加**（既存の `let localAutomationServer` 宣言の後）：
```typescript
let cronJobScheduler: CronJobScheduler | undefined;
```

**bootstrap() 内に追加**（`localAutomation.start();` の直後）：
```typescript
const cronScheduler = new CronJobScheduler(terminalAutomationService, terminalSlotService, appLogStore);
cronJobScheduler = cronScheduler;
cronScheduler.start();
```

**app 終了処理を追加**（`app.on('before-quit')` ハンドラを追加、なければ新規追加）：
```typescript
app.on('before-quit', () => {
  cronJobScheduler?.stop();
});
```

---

### Step 1-4: ビルドと動作確認

```bash
npm run build
```

ビルドが通ることを確認。

**動作確認用テストジョブ**

以下のファイルを作成して Bridge を再起動し、指定時刻にスロットに送信されることを確認：

ファイル: `cron-jobs\test.json`
```json
{
  "name": "test",
  "cron": "* * * * *",
  "slot": 1,
  "text": "echo cron-test-ok",
  "active": true
}
```

毎分 slot1 に `echo cron-test-ok` が送信されれば成功。確認後はファイルを削除するかアーカイブすること。

---

## Phase 2: bridge-cron-tui を repo に同梱

### 対象ディレクトリ
`C:\Users\sgmxk\Desktop\AI\repos\github\harunamitrader\multicli-discord-bridge\bridge-cron-tui`

---

### Step 2-1: 同梱ディレクトリ初期化

```bash
mkdir bridge-cron-tui
cd bridge-cron-tui
```

`package.json` を作成：

```json
{
  "name": "bridge-cron-tui",
  "version": "0.1.0",
  "type": "module",
  "scripts": {
    "start": "node src/index.js"
  },
  "dependencies": {
    "react": "^18.3.1",
    "ink": "^5.1.0",
    "ink-text-input": "^6.0.0",
    "node-cron": "^3.0.3",
    "cronstrue": "^2.50.0"
  }
}
```

```bash
npm install
```

---

### Step 2-2: jobStore.js を作成

`src/jobStore.js`

役割: CRON_JOBS_DIR の JSON ファイルを CRUD する。

```javascript
import { readFileSync, writeFileSync, rmSync, readdirSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CRON_JOBS_DIR = process.env.CRON_JOBS_DIR ?? path.join(__dirname, '../../cron-jobs');
mkdirSync(CRON_JOBS_DIR, { recursive: true });

export function listJobs() {
  return readdirSync(CRON_JOBS_DIR)
    .filter(f => f.endsWith('.json'))
    .map(f => {
      try {
        return JSON.parse(readFileSync(path.join(CRON_JOBS_DIR, f), 'utf-8'));
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

export function saveJob(job) {
  const filePath = path.join(CRON_JOBS_DIR, `${job.name}.json`);
  writeFileSync(filePath, JSON.stringify(job, null, 2), 'utf-8');
}

export function deleteJob(name) {
  rmSync(path.join(CRON_JOBS_DIR, `${name}.json`), { force: true });
}
```

---

### Step 2-3: cronUtils.js を作成

`src/cronUtils.js`

```javascript
import cron from 'node-cron';
import cronstrue from 'cronstrue/i18n.js';

export function validateCron(expr) {
  return cron.validate(expr);
}

export function describeNext(expr) {
  if (!validateCron(expr)) return '無効な cron 式';
  try {
    return cronstrue.toString(expr, { locale: 'ja' });
  } catch {
    return '';
  }
}
```

---

### Step 2-4: JobForm.js を作成

`src/JobForm.js`

フォームフィールド: `name`, `cron`, `slot`, `text`, `timezone`, `active`

要件：
- `ink-text-input` でテキスト入力
- Tab キーで次のフィールドに移動
- `cron` フィールド: 入力のたびに `validateCron()` を呼び、有効なら `describeNext()` の結果を横に緑色で表示
- `slot` フィールド: 左右キーで 1〜4 を切り替え
- `active` フィールド: Space キーでトグル
- Enter キー（最後のフィールドで）: バリデーション後に `onSave(job)` コールバック
- Esc キー: `onCancel()` コールバック

---

### Step 2-5: App.js を作成

`src/App.js`

要件：
- 起動時に `listJobs()` でジョブ一覧を取得して表示
- 上下キーでジョブ選択（カーソル移動）
- `A` キー: `<JobForm>` を表示（新規モード）
- `E` キー: `<JobForm>` を表示（編集モード、選択ジョブを初期値として渡す）
- `D` キー: 確認プロンプト → `Y` で `deleteJob()` 実行 → 一覧更新
- `Space` キー: 選択ジョブの `active` をトグルして `saveJob()` → 一覧更新
- `Q` キー: `process.exit(0)`

JobForm で保存が完了したら `saveJob()` を呼んで一覧を再読み込みする。

---

### Step 2-6: index.js を作成

`src/index.js`

```javascript
import React from 'react';
import { render } from 'ink';
import App from './App.js';

render(<App />);
```

---

### Step 2-7: 動作確認

```bash
cd bridge-cron-tui
npm install
node src/index.js
```

確認項目：
- ジョブ一覧が表示される
- ジョブを追加できる（`cron-jobs\` に JSON ファイルが作成されること）
- active トグルが反映される
- Bridge を起動した状態でジョブが実行されることを確認

---

## 完了条件チェックリスト

### Phase 1
- [ ] `node-cron` / `chokidar` / `@types/node-cron` が package.json に追加されている
- [ ] `src/main/cron/cronJobScheduler.ts` が存在する
- [ ] `src/main/index.ts` で CronJobScheduler が起動・停止されている
- [ ] `npm run build` がエラーなく完了する
- [ ] テストジョブで毎分実行されることを確認済み

### Phase 2
- [ ] `multicli-discord-bridge\bridge-cron-tui` が存在する
- [ ] `node src/index.js` でTUIが起動する
- [ ] ジョブの追加・編集・削除・トグルができる
- [ ] 保存した JSON が Bridge に自動反映される（ホットリロード）
