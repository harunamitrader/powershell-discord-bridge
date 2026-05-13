# Repository Review - 2026-05-13

対象: `C:\Users\sgmxk\Desktop\AI\repos\github\harunamitrader\powershell-discord-bridge`

重点確認範囲:

- DiscordPowerShell 実行
- 添付ファイル保存とパス注入
- terminal snapshot / redraw / diff 抽出
- control command 分岐
- timeout / stop / restart
- Electron 起動とショートカット
- README と実装の整合

修正は未実施。`npm run typecheck` は成功。

## 指摘

### 1. 重大: `ALLOW_USER_IDS` 未設定時に全ユーザー許可になる

根拠:

- `C:\Users\sgmxk\Desktop\AI\repos\github\harunamitrader\powershell-discord-bridge\src\main\bridge\discordBridgeService.ts:850-852`
- `C:\Users\sgmxk\Desktop\AI\repos\github\harunamitrader\powershell-discord-bridge\src\main\bridge\bridgeConfig.ts:41-43`
- `C:\Users\sgmxk\Desktop\AI\repos\github\harunamitrader\powershell-discord-bridge\README.md:248-250`

`isAllowedUser()` が `allowUserIds.length === 0` を許可扱いにしている。README では `ALLOW_USER_IDS` は必須確認項目として扱われているため、設定漏れ時に bot が参加している guild のユーザーがローカル PowerShell を実行できる。

影響:

- 設定ミスが即リモートコード実行相当の権限開放になる。
- 公開サーバーや複数人 guild に bot がいる場合のリスクが高い。

### 2. 高: `!stop` が効かないプロセスで無限 busy になり得る

根拠:

- `C:\Users\sgmxk\Desktop\AI\repos\github\harunamitrader\powershell-discord-bridge\src\main\bridge\terminalAutomationService.ts:104-110`
- `C:\Users\sgmxk\Desktop\AI\repos\github\harunamitrader\powershell-discord-bridge\src\main\bridge\terminalAutomationService.ts:140-141`
- `C:\Users\sgmxk\Desktop\AI\repos\github\harunamitrader\powershell-discord-bridge\src\main\bridge\terminalAutomationService.ts:233-235`
- `C:\Users\sgmxk\Desktop\AI\repos\github\harunamitrader\powershell-discord-bridge\src\main\app\preferencesStore.ts:31-35`
- `C:\Users\sgmxk\Desktop\AI\repos\github\harunamitrader\powershell-discord-bridge\README.md:223-225`

既定 hard timeout は unlimited。`!stop` は abort flag を立てて Ctrl+C を送るだけで、プロンプト復帰または stable 判定が成立しない限り completion loop が抜けない。Ctrl+C を無視する処理、子プロセス、対話型 CLI では channel が busy のまま残る可能性がある。

影響:

- Discord 側の通常リクエストが詰まる。
- queued request も処理されない。
- 復旧が restart 前提になり、stop の期待動作とずれる。

### 3. 高: `!noenterTEXT` が成功扱いになりにくい

根拠:

- `C:\Users\sgmxk\Desktop\AI\repos\github\harunamitrader\powershell-discord-bridge\src\main\bridge\discordBridgeService.ts:1049-1054`
- `C:\Users\sgmxk\Desktop\AI\repos\github\harunamitrader\powershell-discord-bridge\src\main\bridge\terminalAutomationService.ts:135-136`
- `C:\Users\sgmxk\Desktop\AI\repos\github\harunamitrader\powershell-discord-bridge\README.md:181-184`

`!noenterTEXT` は Enter なし送信なのに `expectOutput: true` として処理される。出力が発生しない入力補助用途では soft timeout 後に `no_output_timeout` の失敗扱いになりやすい。

影響:

- 入力自体は成功していても Discord には失敗として返る。
- control command としての利用感が README と合わない。

### 4. 中: code block 返信形式が保存・反映されない

根拠:

- `C:\Users\sgmxk\Desktop\AI\repos\github\harunamitrader\powershell-discord-bridge\src\main\app\preferencesStore.ts:135-138`
- `C:\Users\sgmxk\Desktop\AI\repos\github\harunamitrader\powershell-discord-bridge\src\main\app\preferencesStore.ts:181-185`
- `C:\Users\sgmxk\Desktop\AI\repos\github\harunamitrader\powershell-discord-bridge\src\main\bridge\discordBridgeService.ts:522-531`
- `C:\Users\sgmxk\Desktop\AI\repos\github\harunamitrader\powershell-discord-bridge\README.md:196-199`

`setBridgeSettings()` は `replyFormat: 'command'` を保存するが、`getBridgeSettings()` が `plain-text` 以外を既定値 `plain-text` に戻している。そのため `!replyformatcommand` や Settings の Code block が実質反映されない。

影響:

- README にある返信形式切り替えが機能しない。
- 設定 UI と Discord command の結果表示が実態とずれる。

### 5. 中: 起動ショートカット経由で壊れた/stale build を起動し得る

根拠:

- `C:\Users\sgmxk\Desktop\AI\repos\github\harunamitrader\powershell-discord-bridge\launch-powershell-discord-bridge.cmd:12-18`
- `C:\Users\sgmxk\Desktop\AI\repos\github\harunamitrader\powershell-discord-bridge\package.json:16`
- `C:\Users\sgmxk\Desktop\AI\repos\github\harunamitrader\powershell-discord-bridge\package.json:23-25`
- `C:\Users\sgmxk\Desktop\AI\repos\github\harunamitrader\powershell-discord-bridge\install-shortcuts.ps1:28-31`
- `C:\Users\sgmxk\Desktop\AI\repos\github\harunamitrader\powershell-discord-bridge\README.md:135-139`

launcher は `dist\renderer\index.html` の有無だけで build 要否を判定している。一方、Electron の entrypoint は `dist-electron/main/index.js`。`dist-electron` が欠けている状態や、source 更新後に renderer dist だけ残っている状態では、起動失敗または stale build 起動になり得る。

影響:

- ショートカットからの起動が環境状態に依存して壊れる。
- README の「必要なら build」と実際の判定が一致しない。

### 6. 中: live terminal snapshot が非アクティブ pane の出力で更新されない

根拠:

- `C:\Users\sgmxk\Desktop\AI\repos\github\harunamitrader\powershell-discord-bridge\src\renderer\app\App.tsx:85-88`
- `C:\Users\sgmxk\Desktop\AI\repos\github\harunamitrader\powershell-discord-bridge\src\renderer\app\App.tsx:132-142`
- `C:\Users\sgmxk\Desktop\AI\repos\github\harunamitrader\powershell-discord-bridge\src\main\ipc\registerIpc.ts:172-198`

snapshot publish のトリガーが active session の `session-data` に限定されている。一方、publish される snapshot は全 session の terminal 情報を含む。非アクティブ pane の出力だけが変化した場合、live snapshot は次の active 側イベントまで古くなる。

影響:

- 外部監視や別プロセスが読む snapshot が実画面とずれる。
- 4 pane 固定 UI と snapshot の期待がずれる。

### 7. 低: 添付合計 10MB 制限が実ダウンロード後に再検証されない

根拠:

- `C:\Users\sgmxk\Desktop\AI\repos\github\harunamitrader\powershell-discord-bridge\src\main\bridge\discordAttachmentService.ts:61-63`
- `C:\Users\sgmxk\Desktop\AI\repos\github\harunamitrader\powershell-discord-bridge\src\main\bridge\discordAttachmentService.ts:78-84`
- `C:\Users\sgmxk\Desktop\AI\repos\github\harunamitrader\powershell-discord-bridge\src\main\bridge\discordAttachmentService.ts:140-142`
- `C:\Users\sgmxk\Desktop\AI\repos\github\harunamitrader\powershell-discord-bridge\src\main\bridge\discordAttachmentService.ts:160-165`
- `C:\Users\sgmxk\Desktop\AI\repos\github\harunamitrader\powershell-discord-bridge\README.md:213`

合計 10MB 制限は Discord attachment metadata の `sizeBytes` で事前検証しているが、`fetch().arrayBuffer()` 後の実サイズでは再検証していない。通常の Discord 添付では metadata は信頼しやすいが、リソース保護としては境界が弱い。

影響:

- 想定外サイズのレスポンスを memory / disk に取り込む余地がある。
- 添付保存処理の上限仕様が実データに対して保証されない。
