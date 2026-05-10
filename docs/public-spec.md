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

- **1 Discord チャンネル = 1 PowerShell セッション**
- 同じチャンネルに送ったメッセージは、同じセッションへ順番に送られます
- 許可されていないユーザーやチャンネルのメッセージは無視されます

### 4.2 メッセージ処理

1. 許可済みユーザーが、許可済みチャンネルにメッセージを送る
2. Bot がそのメッセージを受信する
3. 対応する PowerShell セッションを取得または作成する
4. メッセージ内容を PowerShell に送る
5. 実行結果の変化を検出する
6. 結果を Discord に返信する

### 4.3 アプリ画面の位置づけ

- アプリ画面は **現在のセッション状態を確認するためのローカル UI** です
- Discord から送った内容が実際に投入されたか、アプリ側でも確認できます
- `[[terminal:screenshot]]` を送ると、**アプリ画面全体のスクリーンショット**が Discord に返信されます

## 5. 対応している入力

- 通常のテキストメッセージ
- `[[terminal:enter]]`
- `[[terminal:ctrl-c]]`
- `[[terminal:esc]]`
- `[[terminal:stop]]`
- `[[terminal:screenshot]]`

## 6. 安全性に関する仕様

- Bot は `DISCORD_BOT_TOKEN` が設定されているときだけ起動します
- 許可ユーザーは `ALLOW_USER_IDS` で制限します
- 許可チャンネルは `ALLOW_CHANNEL_IDS` で制限します
- 処理中の bridge-managed session には、ローカル UI 側からの通常入力を混ぜない前提で運用します

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
ALLOW_CHANNEL_IDS=...
```

オプション設定:

```env
BRIDGE_SOFT_TIMEOUT_MS=20000
BRIDGE_NO_OUTPUT_TIMEOUT_MS=3000
BRIDGE_HARD_TIMEOUT_MS=120000
```

## 10. 補足

- `.env` はアプリ起動時に自動読み込みされます
- 旧形式の `DISCORD_ALLOWED_USER_ID` / `DISCORD_ALLOWED_CHANNEL_IDS` も互換のため読み取れます
- 詳しい導入方法は `README.md` を参照してください
