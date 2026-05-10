# VS Code terminal feature inventory

## 調査基準

- **ローカル実体**: `C:\Users\sgmxk\AppData\Local\Programs\Microsoft VS Code\8b640eef5a`
- **VS Code バージョン**: `1.116.0`
- **対応 upstream source**: `microsoft/vscode` tag `refs/tags/1.116.0` (`560a9dba96f961efea7b1612916f89e5d5d4d679`)

> ローカルの VS Code 配布物はかなり bundle 済みで、UI 側の terminal 実装は単一/少数の compiled file にまとめられている。  
> そのため **ローカル配布物で存在確認**しつつ、**同一タグの upstream source tree** で機能粒度に分解した。

## ローカル配布物で確認できた terminal 実体

| 区分 | ローカルパス | 役割 |
| --- | --- | --- |
| PTY host runtime | `resources\app\out\vs\platform\terminal\node\ptyHostMain.js` | PTY host の起動点 |
| PTY library | `resources\app\node_modules\node-pty\` | ConPTY / PTY ラッパ |
| shell integration scripts | `resources\app\out\vs\workbench\contrib\terminal\common\scripts\` | bash/zsh/fish/pwsh 統合 |
| terminal suggestion extension | `resources\app\extensions\terminal-suggest\dist\terminalSuggestMain.js` | ターミナル補完 |

## 大分類

| 大分類 | 何をしているか | 主な source | terminal-only アプリでの優先度 |
| --- | --- | --- | --- |
| 1. PTY/ConPTY 起動基盤 | shell spawn、resize、kill、exit、IPC | `src/vs/platform/terminal/node/*` | **必須** |
| 2. Electron 側 backend 接続 | workbench から local PTY host を叩く層 | `src/vs/workbench/contrib/terminal/electron-browser/*` | **必須** |
| 3. terminal instance 管理 | 1 セッション単位の状態、入出力、再接続 | `browser/terminalInstance.ts`, `browser/terminalProcessManager.ts` | **必須** |
| 4. xterm.js ラッパ | 描画、入力、selection、addon 管理 | `browser/xterm/*` | **必須** |
| 5. shell integration / capability | コマンド境界、CWD、prompt 種別、mark | `platform/terminal/common/capabilities/*`, `common/scripts/*`, `common/xterm/shellIntegrationAddon.ts` | **準必須** |
| 6. UI surface | panel/view/tabs/split/editor/menu | `browser/terminalView.ts`, `terminalTabbedView.ts`, `terminalGroup*.ts`, `terminalEditor*.ts` | **要選別** |
| 7. profiles / config | 既定 shell、profile 解決、設定反映 | `terminalProfile*.ts`, `terminalConfiguration*.ts` | **必要なら採用** |
| 8. remote / agent host | remote extension host / remote PTY | `browser/remote*`, `common/remote/*`, `browser/agentHost*` | **後回し** |
| 9. standalone contrib | find, links, suggest, sticky scroll など | `src/vs/workbench/contrib/terminalContrib/*` | **個別採用** |
| 10. AI/chat 拡張 | chat, voice, agent tools | `terminalContrib/chat*`, `voice`, `chatAgentTools` | **まず不要** |

## 1. PTY / ConPTY 起動基盤

### Node/Electron の最重要ファイル

| 機能 | 主なファイル | メモ |
| --- | --- | --- |
| PTY host 起動点 | `src/vs/platform/terminal/node/ptyHostMain.ts` | PTY host process の entrypoint |
| PTY host API 定義 | `src/vs/platform/terminal/node/ptyHost.ts` | PTY host 側の型/接続面 |
| PTY host service | `src/vs/platform/terminal/node/ptyHostService.ts` | PTY host への要求集約 |
| PTY service 本体 | `src/vs/platform/terminal/node/ptyService.ts` | instance の作成/破棄/イベント配信の中心 |
| 実 shell process | `src/vs/platform/terminal/node/terminalProcess.ts` | `node-pty` を包む本丸 |
| process 共通型 | `src/vs/platform/terminal/common/terminalProcess.ts` | browser/node 間の process 契約 |
| 起動用環境構築 | `src/vs/platform/terminal/node/terminalEnvironment.ts` | shell launch 前の env 調整 |
| Windows 補助 | `src/vs/platform/terminal/node/windowsShellHelper.ts` | Windows shell 周辺の補助 |
| child 監視 | `src/vs/platform/terminal/node/childProcessMonitor.ts` | 子プロセス監視 |
| heartbeat | `src/vs/platform/terminal/node/heartbeatService.ts` | host 生存確認 |
| Node PTY host 起動 helper | `src/vs/platform/terminal/node/nodePtyHostStarter.ts` | Node 環境の PTY host 起動 |
| Electron PTY host 起動 helper | `src/vs/platform/terminal/electron-main/electronPtyHostStarter.ts` | Electron main 側の起動 helper |

### この層で実現している機能

1. shell spawn / attach / shutdown
2. resize と terminal dimensions 反映
3. data / exit / error イベント配送
4. Windows ConPTY を含む OS 差分吸収
5. PTY host の分離実行

## 2. Electron 側 backend 接続

| 機能 | 主なファイル | メモ |
| --- | --- | --- |
| local backend | `src/vs/workbench/contrib/terminal/electron-browser/localTerminalBackend.ts` | Electron desktop の local terminal backend |
| local PTY adapter | `src/vs/workbench/contrib/terminal/electron-browser/localPty.ts` | workbench 側 PTY adapter |
| electron contribution | `src/vs/workbench/contrib/terminal/electron-browser/terminal.contribution.ts` | Electron 向け登録 |
| native contribution | `src/vs/workbench/contrib/terminal/electron-browser/terminalNativeContribution.ts` | native 依存の追加初期化 |
| profile resolver (Electron) | `src/vs/workbench/contrib/terminal/electron-browser/terminalProfileResolverService.ts` | OS ネイティブ寄りの profile 解決 |
| remote helper | `src/vs/workbench/contrib/terminal/electron-browser/terminalRemote.ts` | remote 接続補助 |

## 3. terminal instance / lifecycle 管理

| 機能 | 主なファイル | メモ |
| --- | --- | --- |
| terminal instance 本体 | `src/vs/workbench/contrib/terminal/browser/terminalInstance.ts` | UI と process を束ねる最大の中核 |
| process manager | `src/vs/workbench/contrib/terminal/browser/terminalProcessManager.ts` | backend/PTy と instance 間の管理 |
| terminal service | `src/vs/workbench/contrib/terminal/browser/terminalService.ts` | terminal 全体の親サービス |
| base backend | `src/vs/workbench/contrib/terminal/browser/baseTerminalBackend.ts` | local/remote backend の共通土台 |
| detached terminal | `src/vs/workbench/contrib/terminal/browser/detachedTerminal.ts` | view から切り離された terminal 扱い |
| status 管理 | `src/vs/workbench/contrib/terminal/browser/terminalStatusList.ts` | busy/disconnected などの状態 |
| events | `src/vs/workbench/contrib/terminal/browser/terminalEvents.ts` | 主要イベント定義 |
| editing service | `src/vs/workbench/contrib/terminal/browser/terminalEditingService.ts` | instance の入れ替え/移動補助 |
| ext host proxy | `src/vs/workbench/contrib/terminal/browser/terminalProcessExtHostProxy.ts` | extension host 側との橋渡し |

## 4. xterm.js ラッパと画面上の terminal 振る舞い

| 機能 | 主なファイル | メモ |
| --- | --- | --- |
| xterm wrapper | `src/vs/workbench/contrib/terminal/browser/xterm/xtermTerminal.ts` | xterm.js を VS Code 仕様で包む中心 |
| addon import | `src/vs/workbench/contrib/terminal/browser/xterm/xtermAddonImporter.ts` | addon の lazy import |
| decorations | `src/vs/workbench/contrib/terminal/browser/xterm/decorationAddon.ts` | command mark などの装飾 |
| decoration styles | `src/vs/workbench/contrib/terminal/browser/xterm/decorationStyles.ts` | 装飾 CSS/見た目 |
| line data hooks | `src/vs/workbench/contrib/terminal/browser/xterm/lineDataEventAddon.ts` | 行データ取得フック |
| mark navigation | `src/vs/workbench/contrib/terminal/browser/xterm/markNavigationAddon.ts` | command mark / prompt mark 間移動 |
| hover widget | `src/vs/workbench/contrib/terminal/browser/widgets/terminalHoverWidget.ts` | hover UI |
| widget manager | `src/vs/workbench/contrib/terminal/browser/widgets/widgetManager.ts` | widget 管理 |

## 5. shell integration / capability 層

### Shell integration script 実体

- `src/vs/workbench/contrib/terminal/common/scripts/shellIntegration-bash.sh`
- `src/vs/workbench/contrib/terminal/common/scripts/shellIntegration-env.zsh`
- `src/vs/workbench/contrib/terminal/common/scripts/shellIntegration-login.zsh`
- `src/vs/workbench/contrib/terminal/common/scripts/shellIntegration-profile.zsh`
- `src/vs/workbench/contrib/terminal/common/scripts/shellIntegration-rc.zsh`
- `src/vs/workbench/contrib/terminal/common/scripts/shellIntegration.fish`
- `src/vs/workbench/contrib/terminal/common/scripts/shellIntegration.ps1`
- `src/vs/workbench/contrib/terminal/common/scripts/psreadline/*`

### Capability 実装

| 機能 | 主なファイル | メモ |
| --- | --- | --- |
| capability registry | `src/vs/platform/terminal/common/capabilities/capabilities.ts` | capability 種別定義 |
| capability store | `src/vs/platform/terminal/common/capabilities/terminalCapabilityStore.ts` | capability の登録/監視 |
| command detection | `src/vs/platform/terminal/common/capabilities/commandDetectionCapability.ts` | コマンド境界/実行結果 |
| terminal command model | `src/vs/platform/terminal/common/capabilities/commandDetection/terminalCommand.ts` | command 単位のモデル |
| prompt input model | `src/vs/platform/terminal/common/capabilities/commandDetection/promptInputModel.ts` | prompt 入力の追跡 |
| cwd detection | `src/vs/platform/terminal/common/capabilities/cwdDetectionCapability.ts` | 現在ディレクトリ追跡 |
| naive cwd detection | `src/vs/platform/terminal/common/capabilities/naiveCwdDetectionCapability.ts` | fallback CWD 推定 |
| partial command detection | `src/vs/platform/terminal/common/capabilities/partialCommandDetectionCapability.ts` | 部分的な検出 |
| prompt type detection | `src/vs/platform/terminal/common/capabilities/promptTypeDetectionCapability.ts` | prompt 種別検出 |
| shell env detection | `src/vs/platform/terminal/common/capabilities/shellEnvDetectionCapability.ts` | shell env 取得 |
| buffer mark | `src/vs/platform/terminal/common/capabilities/bufferMarkCapability.ts` | mark 付与 |
| xterm shell integration addon | `src/vs/platform/terminal/common/xterm/shellIntegrationAddon.ts` | xterm 側の shell integration 実装 |

### この層で得られる機能

1. コマンドの開始/終了検出
2. CWD 検出
3. prompt / command mark のナビゲーション
4. terminal suggestion / quick fix の前提情報
5. shell integration による UX 向上

## 6. UI surface

### Panel / tabs / split

| 機能 | 主なファイル | メモ |
| --- | --- | --- |
| terminal view | `src/vs/workbench/contrib/terminal/browser/terminalView.ts` | Terminal パネル本体 |
| tabbed view | `src/vs/workbench/contrib/terminal/browser/terminalTabbedView.ts` | tabs + split UI |
| terminal group | `src/vs/workbench/contrib/terminal/browser/terminalGroup.ts` | split group |
| group service | `src/vs/workbench/contrib/terminal/browser/terminalGroupService.ts` | group 全体管理 |
| tabs list | `src/vs/workbench/contrib/terminal/browser/terminalTabsList.ts` | 左ペイン/一覧 UI |
| tabs chat entry | `src/vs/workbench/contrib/terminal/browser/terminalTabsChatEntry.ts` | chat terminal 用 entry |
| context menu | `src/vs/workbench/contrib/terminal/browser/terminalContextMenu.ts` | 右クリックメニュー |
| tooltip | `src/vs/workbench/contrib/terminal/browser/terminalTooltip.ts` | tooltip |
| icon / icon picker | `terminalIcon.ts`, `terminalIconPicker.ts`, `terminalIcons.ts` | terminal icon/codicon |
| resize debouncer | `terminalResizeDebouncer.ts` | resize の間引き |

### Editor integration

| 機能 | 主なファイル | メモ |
| --- | --- | --- |
| terminal editor UI | `src/vs/workbench/contrib/terminal/browser/terminalEditor.ts` | editor tab としての terminal |
| editor input | `src/vs/workbench/contrib/terminal/browser/terminalEditorInput.ts` | editor model |
| editor service | `src/vs/workbench/contrib/terminal/browser/terminalEditorService.ts` | editor 側管理 |
| editor serializer | `src/vs/workbench/contrib/terminal/browser/terminalEditorSerializer.ts` | 復元/serialize |
| terminal URI | `src/vs/workbench/contrib/terminal/browser/terminalUri.ts` | URI 化 |

### Actions / menus / commands / config

| 機能 | 主なファイル | メモ |
| --- | --- | --- |
| primary contribution | `src/vs/workbench/contrib/terminal/browser/terminal.contribution.ts` | terminal 全体登録 |
| main contribution | `src/vs/workbench/contrib/terminal/browser/terminalMainContribution.ts` | 起動時初期化 |
| web contribution | `src/vs/workbench/contrib/terminal/browser/terminal.web.contribution.ts` | web 向け登録 |
| actions | `src/vs/workbench/contrib/terminal/browser/terminalActions.ts` | コマンドの塊 |
| command ids | `src/vs/workbench/contrib/terminal/browser/terminalCommands.ts` | command ID |
| menus | `src/vs/workbench/contrib/terminal/browser/terminalMenus.ts` | menu 定義 |
| config service | `src/vs/workbench/contrib/terminal/browser/terminalConfigurationService.ts` | browser 側 config 解決 |
| context keys | `src/vs/workbench/contrib/terminal/common/terminalContextKey.ts` | when/context 条件 |
| config schema | `src/vs/workbench/contrib/terminal/common/terminalConfiguration.ts` | terminal 設定群 |
| shared strings | `src/vs/workbench/contrib/terminal/common/terminalStrings.ts` | 文言 |
| color registry | `src/vs/workbench/contrib/terminal/common/terminalColorRegistry.ts` | 色テーマ |

## 7. profiles / environment / extension points

| 機能 | 主なファイル | メモ |
| --- | --- | --- |
| profile service | `src/vs/workbench/contrib/terminal/browser/terminalProfileService.ts` | profile 列挙 |
| profile quickpick | `src/vs/workbench/contrib/terminal/browser/terminalProfileQuickpick.ts` | UI 選択 |
| profile resolver | `src/vs/workbench/contrib/terminal/browser/terminalProfileResolverService.ts` | 共通 resolver |
| profile model | `src/vs/platform/terminal/common/terminalProfiles.ts` | profile 型 |
| node profile detection | `src/vs/platform/terminal/node/terminalProfiles.ts` | OS 上の shell 検出 |
| env collection | `src/vs/platform/terminal/common/environmentVariableCollection.ts` | env 変更の集約 |
| env shared helpers | `src/vs/platform/terminal/common/environmentVariable*.ts` | env 変更の契約 |
| workbench env service | `src/vs/workbench/contrib/terminal/common/environmentVariableService.ts` | extension/workspace からの env 注入 |
| terminal env helpers | `src/vs/workbench/contrib/terminal/common/terminalEnvironment.ts` | launch env 合成 |
| extension points | `src/vs/workbench/contrib/terminal/common/terminalExtensionPoints.ts` | extension が terminal に差し込む点 |

## 8. remote / agent host

| 機能 | 主なファイル | メモ |
| --- | --- | --- |
| remote PTY adapter | `src/vs/workbench/contrib/terminal/browser/remotePty.ts` | remote terminal proxy |
| remote backend | `src/vs/workbench/contrib/terminal/browser/remoteTerminalBackend.ts` | remote backend |
| remote channel | `src/vs/workbench/contrib/terminal/common/remote/remoteTerminalChannel.ts` | remote IPC channel |
| remote terminal types | `src/vs/workbench/contrib/terminal/common/remote/terminal.ts` | remote 型 |
| agent host PTY | `src/vs/workbench/contrib/terminal/browser/agentHostPty.ts` | agent/extension host PTY |
| agent host service | `src/vs/workbench/contrib/terminal/browser/agentHostTerminalService.ts` | agent host terminal service |
| agent host contribution | `src/vs/workbench/contrib/terminal/browser/agentHostTerminalContribution.ts` | agent host 統合 |

> terminal-only desktop app なら、この層はほぼ外してよい。

## 9. standalone terminal contributions

`src/vs/workbench/contrib/terminal/terminal.all.ts` から読み取れる standalone contribution 群。

| contribution | 役割の要約 | 主な source root |
| --- | --- | --- |
| accessibility | accessible buffer / a11y 操作 | `src/vs/workbench/contrib/terminalContrib/accessibility` |
| autoReplies | 特定プロンプトへの自動返信 | `src/vs/workbench/contrib/terminalContrib/autoReplies` |
| chat | chat terminal | `src/vs/workbench/contrib/terminalContrib/chat` |
| chatAgentTools | AI/agent の terminal tool 実行 | `src/vs/workbench/contrib/terminalContrib/chatAgentTools` |
| developer | PTY host restart など開発者向け | `src/vs/workbench/contrib/terminalContrib/developer` |
| environmentChanges | env change の表示/UI | `src/vs/workbench/contrib/terminalContrib/environmentChanges` |
| find | terminal 内検索 | `src/vs/workbench/contrib/terminalContrib/find` |
| commandGuide | 現在 command の guide/強調 | `src/vs/workbench/contrib/terminalContrib/commandGuide` |
| history | command history UI | `src/vs/workbench/contrib/terminalContrib/history` |
| inlineHint | 初回ヒント | `src/vs/workbench/contrib/terminalContrib/inlineHint` |
| links | URL/path/link 検出 | `src/vs/workbench/contrib/terminalContrib/links` |
| notification | OSC notification など | `src/vs/workbench/contrib/terminalContrib/notification` |
| zoom | terminal font zoom | `src/vs/workbench/contrib/terminalContrib/zoom` |
| stickyScroll | command 単位の sticky scroll | `src/vs/workbench/contrib/terminalContrib/stickyScroll` |
| quickAccess | quick access 連携 | `src/vs/workbench/contrib/terminalContrib/quickAccess` |
| quickFix | command 出力に対する quick fix | `src/vs/workbench/contrib/terminalContrib/quickFix` |
| typeAhead | 低遅延入力体験 | `src/vs/workbench/contrib/terminalContrib/typeAhead` |
| resizeDimensionsOverlay | resize overlay | `src/vs/workbench/contrib/terminalContrib/resizeDimensionsOverlay` |
| sendSequence | 任意 sequence 送信 | `src/vs/workbench/contrib/terminalContrib/sendSequence` |
| sendSignal | signal 送信 | `src/vs/workbench/contrib/terminalContrib/sendSignal` |
| suggest | shell integration ベース補完 | `src/vs/workbench/contrib/terminalContrib/suggest` |
| wslRecommendation | WSL 推奨表示 | `src/vs/workbench/contrib/terminalContrib/wslRecommendation` |
| voice | 音声入力/音声操作系 | `src/vs/workbench/contrib/terminalContrib/voice` |

### 追加で見つかる contrib root

以下は `terminalContrib` 直下に存在するが、`terminal.all.ts` の standalone import には出ていない:

- `clipboard`

このため clipboard 系は primary terminal contribution 側から組み込まれている可能性が高い。

## 10. terminal-suggest extension

| 機能 | 主な source | メモ |
| --- | --- | --- |
| extension entry | `extensions/terminal-suggest/src/terminalSuggestMain.ts` | 補完 extension 本体 |
| completions | `extensions/terminal-suggest/src/completions/*` | command/flag/path 補完 |
| shell-specific logic | `extensions/terminal-suggest/src/shell/*` | shell 別差分 |
| env helpers | `extensions/terminal-suggest/src/env/*` | shell env 利用 |
| tokens/parser | `tokens.ts`, `types.ts` | 入力解析 |
| upstream specs | `upstreamSpecs.ts` | Fig spec の取り込み管理 |

README / package.json から確認できる点:

1. builtin extension
2. `terminal.integrated.suggest.enabled` で有効化
3. zsh / bash / fish / pwsh 対応
4. `terminalCompletionProvider` と `terminalShellEnv` proposal を利用

## terminal-only アプリ向けの流用しやすさ

### 流用しやすい

- `node-pty`
- `src/vs/platform/terminal/node/*`
- `src/vs/workbench/contrib/terminal/electron-browser/localTerminalBackend.ts`
- `src/vs/workbench/contrib/terminal/browser/terminalProcessManager.ts`
- `src/vs/workbench/contrib/terminal/browser/xterm/*`
- `src/vs/workbench/contrib/terminal/common/scripts/*`
- `src/vs/platform/terminal/common/capabilities/*`

### 流用はできるが VS Code workbench 依存が重い

- `terminalInstance.ts`
- `terminalService.ts`
- `terminalView.ts`
- `terminalTabbedView.ts`
- `terminalGroup*.ts`
- `terminalEditor*.ts`
- `terminalActions.ts`
- `terminalMenus.ts`

### まず外してよい

- `remote*`
- `agentHost*`
- `chat*`
- `voice`
- `wslRecommendation`
- `quickAccess`
- `developer`

## 最小構成で抜き出すなら残す候補

1. **PTY 基盤**: `platform/terminal/node/*`, `platform/terminal/electron-main/electronPtyHostStarter.ts`
2. **Electron 接続**: `workbench/contrib/terminal/electron-browser/localTerminalBackend.ts`, `localPty.ts`
3. **xterm 表示**: `browser/xterm/xtermTerminal.ts` と必要 addon
4. **shell integration**: `common/scripts/*`, `common/xterm/shellIntegrationAddon.ts`, `capabilities/*`
5. **最低限の orchestration**: `browser/terminalProcessManager.ts`

## 重結合で移植コストが高い部分

1. workbench service/container に密結合した UI 層
2. command palette / keybinding / menu registry 前提の action 層
3. editor/panel/tabs/split を全部含む view 管理
4. remote / extension host / chat 系の統合層

## ひとことで言うと

VS Code terminal は **「PTY 基盤 + xterm + shell integration」までは比較的分離可能**。  
一方で **「VS Code らしい完成された terminal UX」** は `terminalInstance.ts` と `terminalService.ts` を中心に workbench 依存が強い。
