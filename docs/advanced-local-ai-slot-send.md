# Advanced: Local AI to slot text send

この機能は **advanced 向けのローカル自動化機能** です。  
通常の使い方は **Discord から各 slot にメッセージを送る運用** で、この機能はその代わりではありません。

## 何ができるか

実行中の Electron アプリに対して、**ローカルの AI CLI / shell から `slot + text + optional Enter` だけを送る**最小操作を使えます。

- slot は `slot1-slot4`
- text は plain text のまま送る
- 必要なら Enter なしにもできる
- slot 内で何の AI / tool が動いているかは前提にしない

## 前提

1. `powershell-discord-bridge` の Electron アプリが **起動中** であること
2. 同じ Windows マシン上から実行すること
3. Node.js 環境でこのリポジトリの CLI を実行できること

この機能は **ローカル専用** です。  
アプリが起動していない場合、CLI は明示的に失敗します。

## 手動で使う

### 1. 1 行テキストを送る

```powershell
npm run slot:send -- --slot slot3 --text "この差分を見て"
```

### 2. Enter なしで送る

```powershell
npm run slot:send -- --slot slot3 --text "draft only" --no-enter
```

### 3. 複数行テキストを送る

```powershell
@'
line 1
line 2
'@ | node .\scripts\bridge-send-slot.cjs --slot slot4
```

## CLI の仕様

- `--slot`: 必須。`1-4` / `slot1-slot4`
- `--text`: 任意。省略時は `stdin` から読む
- `--no-enter`: 任意。末尾 Enter を送らない
- `--json`: 任意。受理結果を JSON で出す
- `--client`: 任意。ログ用ラベル

## skill で使う

この repo は **skill から `slot:send` CLI を呼ぶ**前提で使えます。  
この方法なら `AGENTS.md` を編集せずに、「slot3 にこの文を入力して」のような依頼を AI に処理させやすくなります。

### Copilot skill の設定例

1. 次のフォルダを作ります

```text
C:\Users\<your-user>\.copilot\skills\powershell-discord-bridge-slot-send
```

2. この repo にあるテンプレートを、上のフォルダに `SKILL.md` としてコピーします

```text
docs\skill-examples\powershell-discord-bridge-slot-send\SKILL.md
```

3. Copilot CLI から自然文で依頼します

- `slot3 に "この差分を見て" と入力して`
- `slot4 に Enter なしで "draft only" を送って`

skill 側では内部的に次の CLI を使います。

```powershell
npm run slot:send -- --slot slot3 --text "この差分を見て"
```

### 他の AI CLI で skill を作る場合

skill 機構を持つ AI CLI なら、同じ考え方で構いません。

- 対象 slot を 1 つ選ぶ
- text をそのまま保持する
- 必要なら `--no-enter` を付ける
- 内部では `npm run slot:send -- ...` または `node .\scripts\bridge-send-slot.cjs ...` を呼ぶ

## 推奨の使い分け

- **通常運用**: Discord から送る
- **advanced automation**: skill / local shell から `slot:send` を呼ぶ

まずは **plain text send only** で使うのがおすすめです。  
review / handoff / multi-agent orchestration のような上位概念は、この最小操作の上に別途載せてください。

## トラブルシュート

### Electron app が見つからない

アプリが起動していません。  
先に `powershell-discord-bridge` を起動してから再実行してください。

### text は入れたいが Enter は押したくない

`--no-enter` を付けます。

### 複数行を送りたい

`--text` ではなく `stdin` を使ってください。
