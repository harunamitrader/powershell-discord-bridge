# Advanced: Local AI to slot text send

この機能は **advanced 向けのローカル自動化機能** です。  
通常の使い方は **Discord から各 slot にメッセージを送る運用** で、この機能はその代わりではありません。

## 何ができるか

実行中の Electron アプリに対して、**ローカルの AI CLI / shell から `slot + from + text + optional Enter` を送る**最小操作を使えます。

- slot は `slot1-slot6`
- from は `slot1-slot6` / `human` / `cron` / `external:<label>`
- text は plain text のまま送る
- 送信時に `[from: ...]` ヘッダーを自動で先頭へ付ける
- 必要なら Enter なしにもできる
- 送信前に対象 slot をアプリ側でアクティブ化する
- slot 内で何の AI / tool が動いているかは前提にしない

## 前提

1. `multicli-discord-bridge` の Electron アプリが **起動中** であること
2. 同じ Windows マシン上から実行すること
3. Node.js 環境でこのリポジトリの CLI を実行できること

この機能は **ローカル専用** です。  
アプリが起動していない場合、CLI は明示的に失敗します。

## 手動で使う

### 1. 1 行テキストを送る

```powershell
npm run slot:send -- --slot slot3 --from human --text "この差分を見て"
```

このコマンドは通常、送信後に少し待って **delivery likelihood check** を行います。
返り値は `likely_delivered` / `uncertain` / `likely_not_delivered` の 3 値で、**入力が届いた可能性の高さ**だけを軽く判定します。最終結果の追跡はしません。

### 2. Enter なしで送る

```powershell
npm run slot:send -- --slot slot3 --from human --text "draft only" --no-enter
```

### 3. 複数行テキストを送る

```powershell
@'
line 1
line 2
'@ | node .\scripts\bridge-send-slot.cjs --slot slot4 --from human
```

## CLI の仕様

- `--slot`: 必須。`1-6` / `slot1-slot6`
- `--from`: 必須。`slot1-slot6` / `human` / `cron` / `external:<label>`
- `--text`: 任意。省略時は `stdin` から読む
- `--no-enter`: 任意。末尾 Enter を送らない
- `--notify-on-complete`: 任意。**既定 OFF**。必要なときだけ送信元 slot への完了通知を有効化
- `--origin-slot`: 任意。`--notify-on-complete` を使うときだけ必須
- `--json`: 任意。受理結果を JSON で出す
- `--client`: 任意。ログ用ラベル

### 4. 完了通知を送信元 slot に返す

必要なときだけ、送信元 AI がいる slot に task complete メッセージを返せます。
**skill 経由でも既定は OFF** で、AI が必要と判断したとき、またはユーザーが明示したときだけ有効にしてください。

```powershell
npm run slot:send -- --slot slot3 --from slot2 --text "slot2のCopilotです。処理が終わったら知らせて" --notify-on-complete --origin-slot slot2
```

- 完了通知は `slot2` の terminal に固定フォーマットのメッセージとして注入されます
- `--notify-on-complete` は `--origin-slot` とセットでのみ使えます
- `--no-enter` と同時には使えません

## 追加の観測コマンド

ユーザーが求めたときだけ、AI は次の on-demand 観測を使えます。

### 各 slot の visible text を確認

```powershell
npm run slot:observe -- --slot slot3 --text
```

この visible text は、**terminal 上の visual wrap 改行位置を維持したまま**返ります。表や一覧のような表示を読みたいときは、screenshot より先にこれを使うのがおすすめです。

### 各 slot の screenshot を確認 (`!ss` 相当)

```powershell
npm run slot:observe -- --slot slot3 --screenshot
```

PNG は `%APPDATA%\multicli-discord-bridge\automation-captures\...` に保存され、CLI は保存先 path を JSON で返します。

### アプリ全体の screenshot を確認 (`!wss` 相当)

```powershell
npm run slot:observe -- --window-screenshot
```

### 連携用の slot 状態 JSON を読む

通常ターンではなく、**handoff / report / 他 slot の状況確認が必要なときだけ**読む前提です。

```powershell
npm run slot:observe -- --state
npm run slot:observe -- --slot slot3 --state
```

- 返り値には snapshot 本体と保存先 `filePath` が入ります
- JSON は `%APPDATA%\multicli-discord-bridge\coordination\slot-state.json` に保存されます
- 各 slot には `cwd` / `status` / `updatedAt` / `foregroundCommand` / `recentInbound` が入ります
- `foregroundCommand` は **最後の `promptReady` 後、最初に Enter 付きで送られたコマンド**だけを記録します
- `recentInbound` は直近 5 件だけ保持します
- ここでは `claude` / `gemini` などの意味推定はしません

AI がほかの slot の状況を知りたい場合は、まず `--state` を読み、それでも足りないときだけ **各 slot の visible text を個別に取る**使い分けにします。

## skill で使う

この repo は **skill から `slot:send` / `slot:observe` CLI を呼ぶ**前提で使えます。
この方法なら `AGENTS.md` を編集せずに、「slot3 にこの文を入力して」のような依頼を AI に処理させやすくなります。

### Copilot skill の設定例

1. 次のフォルダを作ります

```text
C:\Users\<your-user>\.copilot\skills\multicli-discord-bridge-slot-send
```

2. text 送信用 skill を使う場合は、この repo にあるテンプレートを上のフォルダに `SKILL.md` としてコピーします

```text
docs\skill-examples\multicli-discord-bridge-slot-send\SKILL.md
```

3. 各 slot の状態確認を自然文で呼びたい場合は、別途次の folder も作ります

```text
C:\Users\<your-user>\.copilot\skills\multicli-discord-bridge-slot-state
```

4. その folder には次のテンプレートを `SKILL.md` としてコピーします

```text
docs\skill-examples\multicli-discord-bridge-slot-state\SKILL.md
```

5. Copilot CLI から自然文で依頼します

- `slot3 に "この差分を見て" と入力して`
- `slot4 に Enter なしで "draft only" を送って`
- `multiCLI の各slotの状態を確認して`

skill 側では内部的に次の CLI を使います。

```powershell
npm run slot:send -- --slot slot3 --from slot2 --text "slot2のCopilotです。この差分を見て"
```

完了通知は **skill でも既定 OFF** です。
別 slot の完了待ちが必要な場合だけ、次のように opt-in します。

```powershell
npm run slot:send -- --slot slot3 --from slot2 --text "slot2のCopilotです。完了したら知らせて" --notify-on-complete --origin-slot slot2
```

- skill で他 slot に依頼を送るときは、CLI が付ける `[from: ...]` ヘッダーに加えて、本文の先頭でも `slot2のCopilotです。` のように短く名乗ります
- 自分の所属 slot が分からない場合は、まず人間に確認します
- 人間確認なしで進めてよい場合のみ、`slot1-slot6` の visible text を読んで自分の slot を特定してから送ります
- 自分の所属 slot を特定できないまま `--from slotN` を推測で付けて送ってはいけません

必要なときだけ、次の観測系も使います。

```powershell
npm run slot:observe -- --state
npm run slot:observe -- --slot slot3 --text
npm run slot:observe -- --slot slot3 --screenshot
npm run slot:observe -- --window-screenshot
```

- send skill は **送信専用** に保ち、handoff / report / target-slot selection のような連携判断が必要なときは、先に `multicli-discord-bridge-slot-state` skill を使います
- state skill は基本的に `npm run slot:observe -- --state` を使い、必要なら `--slot slotN --state` に絞ります

### 他の AI CLI で skill を作る場合

skill 機構を持つ AI CLI なら、同じ考え方で構いません。

- 対象 slot を 1 つ選ぶ
- `--from` に送信者ラベルを明示する
- text をそのまま保持する
- AI が他 slot に依頼する場合は、本文の先頭で短く名乗る
- 必要なら `--no-enter` を付ける
- 完了通知は必要な場合だけ `--notify-on-complete --origin-slot ...` を付ける
- 内部では `npm run slot:send -- ...` または `node .\scripts\bridge-send-slot.cjs ...` を呼ぶ

## 推奨の使い分け

- **通常運用**: Discord から送る
- **advanced automation**: skill / local shell から `slot:send` を呼ぶ

まずは **plain text send only** で使うのがおすすめです。  
review / handoff / multi-agent orchestration のような上位概念は、この最小操作の上に別途載せてください。

## トラブルシュート

### Electron app が見つからない

アプリが起動していません。  
先に `multicli-discord-bridge` を起動してから再実行してください。

### text は入れたいが Enter は押したくない

`--no-enter` を付けます。

### 複数行を送りたい

`--text` ではなく `stdin` を使ってください。
