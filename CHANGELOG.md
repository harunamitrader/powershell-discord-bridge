# Changelog

このファイルは、このプロジェクトの公開向け更新履歴を記録します。

## [0.1.0] - 2026-05-10

### Added

- Discord から PowerShell セッションへ入力を送る bridge 機能
- 1 Discord チャンネル = 1 セッションの基本運用
- アプリ画面全体を Discord に返す `[[terminal:screenshot]]`
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
- 許可ユーザー / 許可チャンネルの環境変数に後方互換を追加

### Fixed

- Discord -> Electron -> Gemini / PowerShell 送信時の false completion 問題を修正
- テキスト送信時に入力だけ残って実際には submit されない問題を修正
