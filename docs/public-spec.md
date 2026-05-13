# PowerShell Discord Bridge 公開仕様書

## 1. 概要

PowerShell Discord Bridge は、**Windows PC 上の PowerShell を Discord から操作するための Electron アプリ**です。  
アプリ本体はローカル PC で動作し、Discord 側のメッセージを PowerShell に送り、その実行結果を Discord に返します。

このプロジェクトは、**リモート管理用の一般公開 bot** ではなく、**ローカル PC を自分で操作するための bridge ツール**として設計されています。

## 2. 想定ユースケース

- 自宅 PC や手元の Windows マシンで PowerShell を Discord 経由で操作したい
- Discord 上から AI CLI や対話型 CLI を間接的に使いたい
- Discord のやり取りと、実際のターミナル画面の両方を確認しながら運用したい

## 3. 対応環境

- OS: Windows
- ターミナル: PowerShell
- アプリ形式: Electron デスクトップアプリ
- Discord 連携: Bot トークンを使った通常メッセージ連携

## 4. 基本動作

### 4.1 チャンネルとセッション

- アプリ画面には **2x2 の 4固定 PowerShell セッション** を表示します
- 各枠は固定の slot として扱われます
- **1 Discord チャンネル = 1 slot = 1 PowerShell セッション** の対応で運用します
- 同じチャンネルに送ったメッセージは、同じ slot のセッションへ送られます
- 応答生成中に追加の text / control 入力が来た場合は、キューせず実行中セッションへそのまま流し込みます
- 応答返信は最初の bridge-managed リクエストに対して返し、途中の追加入力自体には個別返信しません
- 許可されていないユーザーのメッセージは無視されます
- guild 制限を設定した場合は、その guild 外のメッセージも無視されます

### 4.2 メッセージ処理

1. 許可済みユーザーが、対象 guild 内のチャンネルにメッセージを送る
2. Bot がそのメッセージを受信する
3. 対応する slot の PowerShell セッションへルーティングする
4. メッセージ内容を PowerShell に送る
5. 実行結果の変化を検出する
6. 結果を Discord に返信する

### 4.3 アプリ画面の位置づけ

- アプリ画面は **現在のセッション状態を確認するためのローカル UI** です
- Discord から送った内容が実際に投入されたか、アプリ側でも確認できます
- `!screenshot` を送ると、**アプリ画面全体のスクリーンショット**が Discord に返信されます
- ヘッダー右上の **Logs** から、bridge の起動ログ・stderr・terminal 入力ログをアプリ内オーバーレイで確認できます

## 5. 対応している入力

- 通常のテキストメッセージ
- `!/command`
- `!noenterTEXT`
- `!enter`
- `!ctrlc`
- `!esc`
- `!stop`
- `!screenshot`
- `!ss`
- `!windowscreenshot`
- `!wss`
- `!restartterminal`
- `!rst`
- `!restartapp`
- `!rsa`
- `!autoscreenshoton`
- `!autoscreenshotoff`
- `!autoscreenshot`
- `!hardtimeout`
- `!hardtimeoutunlimited`
- `!hardtimeoutoff`
- `!replyformat`
- `!replyformatcommand`
- `!replyformattext`

## 6. 安全性に関する仕様

- Bot は `DISCORD_BOT_TOKEN` が設定されているときだけ起動します
- 許可ユーザーは `ALLOW_USER_IDS` で制限します
- 必要な場合のみ `ALLOW_GUILD_ID` で対象 guild を 1 つ指定できます
- 各 slot は保存された Discord channel ID を持ち、再起動後も同じ channel に紐づき続けます
- slot の channel ID が空なら、起動時または設定保存時に Discord channel を自動作成します
- 処理中の bridge-managed session に対しても、ローカル UI 側や Discord 側から通常入力を追加できます
- 自動スクリーンショット送信は Electron アプリ側設定または Discord コマンドで ON / OFF できます
- Discord 返信形式、soft timeout / hard timeout / fixed bridge dimensions は Electron アプリ側設定で変更できます
- 各 slot の default working directory は Electron アプリ側設定で変更できます

## 7. 現在の制限

- Windows 専用です
- PowerShell 専用です
- slash command ではなく通常メッセージ前提です
- 不特定多数が参加する公開チャンネルでの利用は想定していません
- 複数シェル対応、細かな権限管理、完全な TUI 互換は未対応です

## 8. 非対応・対象外

- Linux / macOS 対応
- cmd / bash / zsh / WSL の正式サポート
- 複数ロールに応じた高度な権限管理
- Discord スレッド単位の複雑なセッション運用
- SaaS / クラウドサービスとしての提供

## 9. 設定項目

最低限必要な設定:

```env
DISCORD_BOT_TOKEN=...
ALLOW_USER_IDS=...
```

オプション設定:

```env
ALLOW_GUILD_ID=...
```

## 10. 補足

- `.env` はアプリ起動時に自動読み込みされます
- 旧形式の `DISCORD_ALLOWED_USER_ID` / `DISCORD_ALLOWED_GUILD_IDS` も互換のため読み取れます
- 詳しい導入方法は `README.md` を参照してください

## 11. 固定4枠レイアウト

- 左サイドバーはなく、アプリ本体は 2x2 の 4分割レイアウトです
- 各枠のタイトルバーに、その枠の状態表示と Restart 操作があります
- 設定はヘッダー右上の Settings から別画面で開きます
- Logs もヘッダー右上から Settings と同様のオーバーレイで開きます
- 設定画面では、Global 設定と Per terminal 設定を分けて管理します
- Global 設定の初期値は、`plain text` 返信、`soft timeout 60s`、`hard timeout unlimited`、`100x100` bridge サイズです
- Global 設定の bridge rows は `15` 以上で設定します
- ワークスペース名を変更した場合は、対応する Discord チャンネル名も追従して変更されます
