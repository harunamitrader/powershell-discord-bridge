# PowerShell Discord Bridge

PowerShell Discord Bridge は、**自分の Windows PC 上の PowerShell を Discord から操作するためのデスクトップアプリ**です。  
Discord に送ったメッセージを PowerShell に渡し、返ってきた結果を Discord に返します。アプリ側では同じセッションの画面を見続けられるので、「今 PC 上で何が動いているか」を確認しながら使えます。

> **大事な前提**
>
> このツールは **あなたの PC 上で PowerShell を実行します**。  
> つまり、許可した Discord ユーザーから送られた内容は、あなたの PC に対する操作になります。公開サーバーに入れる汎用 bot ではなく、**自分用・小規模運用向けのローカルツール**として考えてください。

## できること

- Discord の 1 チャンネルを 1 つの PowerShell セッションにひも付ける
- 起動時に 4 つの固定 PowerShell 枠を自動で立ち上げる
- Discord に送った文章を、そのまま PowerShell 側へ入力する
- 実行結果の差分を Discord に返信する
- `[[terminal:screenshot]]` で **アプリ画面全体のスクリーンショット**を Discord に返す
- アプリ側でも同じセッション画面を見て、進行状況や出力を確認する

## 現在の制限

- **Windows 専用**
- **PowerShell 専用**
- Discord の slash command ではなく、通常メッセージ入力ベース
- 複数のシェル（cmd / bash / zsh / WSL など）は未対応
- インストーラー付き配布ではなく、**現時点ではソースコードから起動**する形

## 先に用意するもの

導入前に、次の 4 つを用意してください。

1. **Windows PC**
2. **Node.js 20 以降**
3. **Discord アカウント**
4. **自分で管理できる Discord サーバー**

PowerShell は Windows 標準版でも動きますが、**PowerShell 7** を入れておくことをおすすめします。

## 導入手順

### 1. このリポジトリを PC に置く

Git を使う場合:

```powershell
git clone https://github.com/harunamitrader/powershell-discord-bridge.git
cd powershell-discord-bridge
```

Git を使わない場合は、GitHub の **Code > Download ZIP** からダウンロードして、わかりやすい場所に展開してください。

### 2. Discord Bot を作る

1. Discord Developer Portal を開く
2. **New Application** で新しいアプリを作る
3. **Bot** を追加する
4. Bot Token を発行して控える
5. **MESSAGE CONTENT INTENT** を有効にする
6. OAuth2 の URL Generator から bot 招待 URL を作り、自分の Discord サーバーへ招待する

最低限、Bot には次の権限が必要です。

- 対象チャンネルを見る
- メッセージを読む
- メッセージを送る
- ファイルを添付する
- リアクションを付ける

### 3. Discord で ID をコピーできるようにする

Discord の **設定 > 詳細設定 > 開発者モード** を ON にしてください。  
これで、ユーザー ID や guild ID を右クリックからコピーできるようになります。

必要なのは次の ID です。

- **あなた自身のユーザー ID**
- **必要なら対象にしたい guild の ID**

## 4. 設定ファイルを作る

このフォルダで `.env.example` をコピーして `.env` を作ります。

```powershell
Copy-Item .env.example .env
```

`.env` をメモ帳などで開いて、最低限ここを書き換えてください。

```env
DISCORD_BOT_TOKEN=ここにBotトークン
ALLOW_USER_IDS=ここにあなたのDiscordユーザーID
```

必要なら、対象 guild を 1 つだけ指定できます。

```env
ALLOW_USER_IDS=123456789012345678,234567890123456789
ALLOW_GUILD_ID=345678901234567890
```

### 補足

- `.env` はアプリ起動時に自動で読み込まれます
- `ALLOW_GUILD_ID` を空にすると、**bot が参加している guild 内を広く対象**にします
- 以前の名前 (`DISCORD_ALLOWED_USER_ID`, `DISCORD_ALLOWED_GUILD_IDS`) も互換のため読み取れますが、**これから設定する場合は `ALLOW_USER_IDS` / `ALLOW_GUILD_ID` を使ってください**

## 5. 初回起動

一番簡単なのは、プロジェクト直下の次のファイルを実行する方法です。

```powershell
.\launch-powershell-discord-bridge.cmd
```

この起動スクリプトは、必要なら自動で次を行います。

- `npm install`
- `npm run build`
- `npm run start`

手動でやる場合は次の通りです。

```powershell
npm install
npm run build
npm start
```

## 6. 使い方

1. アプリを起動する
2. アプリ起動時に、**4つ固定の PowerShell 枠** が自動で作成される
3. 各枠は保存済みの設定を使って、同じ Discord チャンネルに再接続される
4. 各枠の channel ID が空なら、指定 guild に Discord チャンネルが自動作成される
5. そのチャンネルに普通のメッセージを送る
6. 対応する PowerShell 枠で Discord の内容が処理される
7. 結果が Discord に返る

各枠は固定で、増減はできません。  
ワークスペース名を変更した場合は、対応する Discord チャンネル名も同じ名前に追従して変更されます。  
各枠の PowerShell は **Restart** で再起動できます。

### よく使うコマンド

- 通常のメッセージ: PowerShell へそのまま送信
- `!enter`: Enter だけ送る
- `!ctrlc`: Ctrl+C を送る
- `!esc`: Escape を送る
- `!stop`: 進行中のリクエスト停止を試みる
- `!screenshot`: アプリ画面のスクリーンショットを Discord に返す
- `!autoscreenshoton`: 各返信完了後の自動スクリーンショット送信を ON
- `!autoscreenshotoff`: 各返信完了後の自動スクリーンショット送信を OFF
- `!autoscreenshot`: 現在の ON/OFF 状態を確認

設定は Electron アプリ右上の **Settings** から開きます。  
設定は **Global** と **Per terminal** に分かれています。

- **Global:** 自動スクリーンショット送信 ON/OFF、soft timeout / hard timeout、bridge 用の固定 cols / rows、既定のワークスペースディレクトリ
- **Per terminal:** ワークスペース名、Discord channel ID、その枠の作業ディレクトリ

## はじめて使うときのおすすめ確認

最初は、許可したチャンネルで次のような安全な入力から始めるのがおすすめです。

```text
Get-Date
```

返答が返ってきたら、次に次のような軽い確認をします。

```text
Get-Location
```

## うまく動かないとき

### Discord に何も返ってこない

次を確認してください。

- `DISCORD_BOT_TOKEN` が正しいか
- `ALLOW_USER_IDS` に自分のユーザー ID が入っているか
- `ALLOW_GUILD_ID` を設定している場合、その guild ID が正しいか
- Bot がそのチャンネルを読めるか
- Discord Developer Portal で **MESSAGE CONTENT INTENT** を有効にしたか

### アプリは起動するが PowerShell が期待どおり動かない

- PowerShell 7 を入れているか
- 会社 PC などで実行ポリシーやセキュリティ制限が強すぎないか
- ローカルで PowerShell 自体は普通に起動できるか

### 起動に失敗する

- Node.js 20 以降が入っているか
- 一度プロジェクトフォルダで `npm install` をやり直す

## 安全に使うための注意

- このツールは **許可した Discord メッセージを自分の PC に流し込む** ものです
- 公開サーバーや不特定多数が書き込めるチャンネルでは使わないでください
- `ALLOW_USER_IDS` は必ず絞ってください
- 必要なら `ALLOW_GUILD_ID` で guild を絞ってください
- `.env` は Git にコミットしないでください

## 公開ドキュメント

- 公開仕様書: `docs/public-spec.md`
- 更新履歴: `CHANGELOG.md`

## ライセンス

MIT
