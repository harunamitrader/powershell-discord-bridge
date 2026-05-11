# Changelog

このファイルは、このプロジェクトの公開向け更新履歴を記録します。

## [0.1.0] - 2026-05-10

### Added

- Discord から PowerShell セッションへ入力を送る bridge 機能
- 1 Discord チャンネル = 1 セッションの基本運用
- アプリ画面全体を Discord に返すスクリーンショット機能
- 返信完了後にアプリ画面スクリーンショットを自動送信する設定
- `!enter`, `!ctrlc`, `!esc`, `!stop`, `!screenshot` コマンド
- `!autoscreenshoton`, `!autoscreenshotoff`, `!autoscreenshot` コマンド
- 4つの固定 slot ごとの Discord チャンネル自動作成と自動紐づけ
- 全体既定のワークスペースディレクトリ設定
- 各 slot のワークスペース名設定と Discord チャンネル名追従リネーム
- 2x2 の 4固定 PowerShell レイアウト
- 右上 Settings から開く専用設定画面
- 各固定 terminal ごとの channel ID / workspace 名 / cwd 設定
- タブ close 時の確認ダイアログ
- アプリ終了時の確認ダイアログ
- 日本語 README
- 公開向け仕様書 `docs/public-spec.md`
- `LICENSE`
- `.env.example`
- `CONTRIBUTING.md`

### Changed

- プロジェクト名を `powershell-discord-bridge` に変更
- UI 上の不要なボタンを整理
- リネーム UI をアプリ内編集に変更
- `.env` をアプリ起動時に自動読み込みするよう改善
- 許可ユーザー / guild 制限の環境変数に後方互換を追加
- bridge の soft timeout / hard timeout / fixed dimensions をアプリ設定へ移動
- guild 設定を単一 `ALLOW_GUILD_ID` ベースに整理
- 左サイドバー UI を廃止し、固定4枠レイアウトと各 terminal のタイトルバー操作へ移行

### Fixed

- Discord -> Electron -> Gemini / PowerShell 送信時の false completion 問題を修正
- テキスト送信時に入力だけ残って実際には submit されない問題を修正
