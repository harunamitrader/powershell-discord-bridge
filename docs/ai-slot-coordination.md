# AI slot 連携と skill template

multicli-discord-bridge では、**AI 間の slot 連携を標準機能**として扱います。  
ただし、これは主に **AI skill が内部的に使うための機能**です。通常のユーザーが `slot:send` や `slot:observe` を直接打つことは想定していません。

## 何ができるか

アプリ起動中は、ローカル専用 automation endpoint を通じて次の 3 種類を使えます。

1. **他 slot へテキスト送信**
2. **他 slot の共有状態確認**
3. **他 slot の visible text 取得**

必要なときだけ、slot screenshot や app window screenshot も取得できます。

## 同梱している 3 つの template

この repo には次の Copilot skill template を同梱しています。

- `docs\skill-templates\multicli-discord-bridge-slot-send\SKILL.md`
- `docs\skill-templates\multicli-discord-bridge-slot-state\SKILL.md`
- `docs\skill-templates\multicli-discord-bridge-slot-text\SKILL.md`

template にしている理由は、ユーザーごとに

- repo の絶対パス
- `C:\Users\<your-user>\.copilot\skills\...` のユーザー名
- 実際に使う AI CLI

が異なるためです。

## Copilot への導入方法

1. 次のフォルダを作ります

```text
C:\Users\<your-user>\.copilot\skills\multicli-discord-bridge-slot-send
C:\Users\<your-user>\.copilot\skills\multicli-discord-bridge-slot-state
C:\Users\<your-user>\.copilot\skills\multicli-discord-bridge-slot-text
```

2. 各 template を対応するフォルダへ `SKILL.md` としてコピーします
3. コピー先ファイルにある `<repo-path>` を、自分の repo path に置き換えます

## 3 つの skill の役割

### 1. slot-send

- 役割: 他 slot に plain text を送る
- 使うタイミング: 依頼・handoff・レビュー依頼・報告依頼
- 使わないタイミング: 状況確認だけしたいとき

### 2. slot-state

- 役割: 各 slot の軽量 shared state を読む
- 読める項目: `cwd` / `status` / `updatedAt` / `foregroundCommand` / `recentInbound`
- 使うタイミング: まず全体状況を把握したいとき

`foregroundCommand` は **最後の `promptReady` 後、最初に Enter 付きで送られたコマンド**だけを記録します。  
ランタイムの意味推定はしません。

### 3. slot-text

- 役割: visible text を読む
- 使うタイミング: state だけでは足りず、実際の terminal 表示を確認したいとき
- 使わないタイミング: まず全体の軽量確認だけしたいとき

## 推奨フロー

1. **state skill**
2. 必要なら **text skill**
3. 実際の依頼は **send skill**

この順にしておくと、send skill の責務が広がりすぎません。

## AI 向けの内部コマンド

通常のユーザー向けではなく、template / skill 作者向けの最小情報だけ載せます。

### 他 slot にテキスト送信

```powershell
npm run slot:send -- --slot slot3 --from slot2 --text "slot2のCopilotです。この差分をレビューしてください"
```

- `--from` は必須
- `--no-enter` で Enter なし送信
- `--notify-on-complete --origin-slot slotN` は **必要なときだけ**

### 他 slot の shared state を読む

```powershell
npm run slot:observe -- --state
npm run slot:observe -- --slot slot3 --state
```

### 他 slot の visible text を読む

```powershell
npm run slot:observe -- --slot slot3 --text
```

### screenshot が必要なときだけ使う

```powershell
npm run slot:observe -- --slot slot3 --screenshot
npm run slot:observe -- --window-screenshot
```

## ルール

- 連携用コマンドは、**人間が直接使う前提ではなく AI が使う前提**
- まずは `state` を優先し、足りないときだけ `text`
- `send` は送信専用に保つ
- completion callback は既定 OFF のままにする
- screenshot は明示的に必要なときだけ使う
