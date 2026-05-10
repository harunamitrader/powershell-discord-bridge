# Discord terminal bridge specification

## 1. Goal

`powershell-discord-bridge` を Discord チャットから操作し、**1 Discord チャンネル = 1 terminal セッション** の前提で、ユーザーが送信したメッセージに対する terminal 画面変化の差分を Discord に返信する。

対象の主ユースケースは、`gemini-cli` のような対話型 CLI を Discord 上から間接操作すること。

## 2. Confirmed assumptions

- 対応単位: **1 Discord チャンネル = 1 terminal セッション**
- 初期対象 terminal: 現行実装の PowerShell セッション
- 実行環境: Windows ローカルマシン上の Electron アプリ
- Discord 側: bot が対象チャンネルのメッセージを購読できること
- 対象入力: **チャンネル内の全発言を terminal 入力対象にする**
- 許可ユーザー: **`ALLOW_USER_IDS` を env で指定し、その user ID のみ受け付ける**
- 許可チャンネル: **`ALLOW_CHANNEL_IDS` を env で指定し、その channel ID のみ受け付ける**
- terminal の論理サイズ: **テキスト取得と運用時を通じて固定**
- Electron ウィンドウの見切れ/表示問題: **Electron 側スクロールで吸収し、PTY の通常運用サイズは変えない**
- redraw / flicker を許容するのは **before snapshot / after snapshot の各 1 回のみ**
- snapshot 取得以外の通常運用中は、**内部 resize を頻繁に発生させない**
- 主目的は **Discord から AI CLI を使うこと**であり、複雑な TUI 互換は best-effort とする
- Discord 処理中または terminal busy 中は、**Electron UI からの入力を禁止**する
- ただし、**処理の強制停止操作は許可**する
- 開発段階では、情報漏洩対策は **`ALLOW_USER_IDS` / `ALLOW_CHANNEL_IDS` と運用注意を優先し、厳格な制限は後段で強化**する

## 3. User workflow

1. ユーザーが Discord チャンネルにメッセージを送る
2. bot がメッセージを受信する
3. bot が対象チャンネルに紐づく terminal セッションを特定する
4. 入力前スナップショット取得のため、terminal に再描画を誘発する
5. 再描画後の terminal 全文を取得して `beforeSnapshot` として保存する
6. ユーザーメッセージを terminal に送信する
7. bot が反応中リアクションを付与する
8. terminal 出力の変化を監視し、完了条件を満たしたら処理完了とみなす
9. 再度 terminal に再描画を誘発する
10. terminal 全文を取得して `afterSnapshot` として保存する
11. `beforeSnapshot` と `afterSnapshot` の差分を抽出する
12. 差分テキストを Discord に返信する

## 4. Current implementation status

現行 `powershell-discord-bridge` にあるもの:

- PowerShell セッション生成
- PTY 経由の入出力
- xterm.js での表示
- resize API
- terminal データのイベント配信
- 簡易 shell integration による CWD 取得

現行 `powershell-discord-bridge` に**まだ無い**もの:

- Discord bot 接続
- チャンネルと terminal セッションのマッピング管理
- terminal 全文取得 API
- scrollback を含む transcript 永続化
- メッセージ送信前後の snapshot 比較
- 完了判定ロジック
- Discord 返信フォーマット

## 5. Scope

### In scope

- Discord bot 受信/返信
- チャンネルと terminal セッションの 1:1 管理
- pre-send / post-send の snapshot 取得
- scrollback を含む全文保存
- inactivity ベースの完了判定
- 差分抽出と Discord 返信
- Discord 実行中の Electron UI 入力ロック
- 強制停止導線の提供

### Out of scope

- 複数ユーザー権限管理
- セッションのリモート共有制御
- Discord スレッド単位マッピング
- slash command 主体の UX
- 高精度な意味理解付き要約
- 複数 shell 対応
- 任意の複雑な TUI に対する完全互換保証

## 6. Architecture

## 6.1 Main components

| Component | Layer | Responsibility |
| --- | --- | --- |
| `DiscordBridgeService` | Electron main | Discord gateway 接続、message 受信、reaction/返信送信 |
| `ChannelSessionRegistry` | Electron main | `channelId -> terminalSessionId` の管理 |
| `TerminalAutomationService` | Electron main | snapshot 取得、入力送信、完了待機、差分計算のオーケストレーション |
| `TerminalSnapshotService` | Electron main + headless mirror | fixed-size xterm buffer state の保持、snapshot 保存、raw transcript 補助保持 |
| `TerminalDiffService` | Electron main | before/after snapshot の差分抽出 |
| `DiscordReplyFormatter` | Electron main | Discord の文字数制限に合わせた返信整形 |

## 6.2 Recommended internal split

### A. DiscordBridgeService

- `discord.js` などで bot 接続
- 対象チャンネルのメッセージを購読
- 対象外メッセージの無視
- `processing`, `done`, `error` リアクション付与

### B. ChannelSessionRegistry

- `channelId -> terminalSessionId`
- `channelId -> inFlightRequest`
- 永続化対象:
  - `channelId`
  - `terminalSessionId`
  - `lastMessageId`
  - `createdAt`
  - `updatedAt`

### C. TerminalAutomationService

- `captureBefore(channelId)`
- `sendInput(channelId, content)`
- `waitForCompletion(channelId)`
- `captureAfter(channelId)`
- `buildReply(channelId)`

### D. TerminalSnapshotService

v1 の **canonical snapshot** は、**fixed-size xterm buffer state の serialization** とする。  
raw transcript は canonical snapshot ではなく、**監査ログ / デバッグ / fallback** 用の補助データとする。

v1 の推奨実装は **main 側 headless mirror**。

- PTY の raw data を main 側の mirror xterm に流す
- mirror xterm は `120 x 32` の固定論理サイズを維持する
- snapshot は mirror xterm の buffer state から serialize する
- raw transcript は別ストリームとして append-only で保持する

これにより、Discord bot 側の処理を renderer の可視状態や UI タイミングに依存させない。

### E. Terminal ownership and write policy

- session は **normal desktop session** と **bridge-managed session** を区別する
- bridge-managed session が `busy` の間、**local write は main 側で拒否**する
- renderer 側の無効化は UX 用であり、排他の最終保証は main 側 write gate が担う
- stop 専用 API は write gate の例外として扱う

## 6.3 Fixed logical terminal size

Discord bridge モードでは、PTY の論理サイズを Electron ウィンドウサイズと切り離す。

- 推奨固定値:
   - `fixedCols = 120`
   - `fixedRows = 32`
- bridge-managed session では **PTY と renderer xterm の両方**をこの固定サイズで維持する
- bridge-managed session では `FitAddon` による resize sync を無効化する
- Electron ウィンドウのリサイズでは **PTY resize も renderer xterm resize も送らない**
- terminal surface 自体を固定サイズとして扱い、viewport が足りない場合は Electron 側スクロールバーで閲覧させる
- redraw 誘発時のみ、一時的に `fixedCols - 1` へ変更し、直後に `fixedCols` へ戻す
- normal desktop session は既存の resize policy を維持してよいが、bridge-managed session と混同しない

これにより、before/after 比較時の折返しノイズを最小化する。

## 7. Functional specification

## 7.1 Channel-session binding

- 初回メッセージ時にチャンネルへ terminal セッションを割り当てる
- 既存割り当てがあれば再利用する
- terminal セッションが死んでいたら再作成する

### Rule

- `ALLOW_CHANNEL_IDS` に含まれない channel では binding を作成しない
- 未許可 channel の message は完全無視する
- 1 チャンネル内では **常に 1 本の直列キュー**
- 同時に 2 件以上のメッセージ処理はしない
- 処理中メッセージがある場合、新規メッセージは **1 件だけ** queue に積む
- `inFlightRequest = 1`、`queuedRequest = 1` を上限とする
- queue が既に埋まっている場合、それ以降の新規メッセージは reject し、`busy` 系リアクションまたは短い案内で返す

### Request state model

```ts
type BridgeRequestState =
  | 'received'
  | 'queued'
  | 'running'
  | 'aborting'
  | 'completed'
  | 'failed'
  | 'rejected'
  | 'cancelled';
```

- `received` は受信直後
- `queued` は in-flight の後ろで待機中
- `running` は snapshot / input / wait / diff / reply を含む実行中
- `aborting` は stop 処理中
- `completed` は成功 reply 完了
- `failed` は timeout / snapshot failure / session death など
- `rejected` は queue overflow や allowlist 不一致
- `cancelled` は stop、hard stop、session death などの影響で破棄された待機 request

### UI lock rule

- `inFlightRequest` がある間は、Electron UI の `send input` / paste / Enter 送信を無効化する
- terminal 表示の閲覧、選択、コピー、スクロールは許可する
- Discord 側からの処理が始まったら session status を `busy` にする
- 完了、失敗、停止のいずれかで `active` に戻す
- **main 側 write gate** により、bridge-managed かつ `busy` な session への local write は拒否する
- renderer 側の UI lock だけでは排他保証とみなさない

### Force stop rule

- UI と Discord bridge の両方から **強制停止** を実行できるようにする
- stop は **通常入力 queue をバイパスする priority control path** とする
- 強制停止時は進行中 request を `aborting` 状態へ遷移させる
- 初期実装は **soft stop 優先**とし、対象 terminal に `Ctrl+C` を送る
- soft stop で一定時間内に収束しない場合は、session kill / recreate の hard stop を許容する
- 停止後の Discord 返信は、通常 diff ではなく `stopped` 系メッセージを返してよい
- stop 実行時、**queued request は v1 ではすべて `cancelled` として破棄**する
- hard stop 後、queued request を自動再実行しない
- hard stop 後の session は **recreated but clean** とし、CLI 内部状態の復元は行わない

## 7.2 Pre-send redraw and snapshot

### Purpose

- `gemini-cli` のような TUI/CLI が内部状態を画面再描画で確定する場合、入力前の terminal 全文を安定化して取得する

### Behavior

1. 固定サイズ `fixedCols` / `fixedRows` を確認する
2. 一時的に `fixedCols - 1` に resize
3. 短い待機を入れる
4. `fixedCols` / `fixedRows` に戻す
5. 追加待機後、snapshot を採取

### Default values

- fixed terminal size: `120 x 32`
- resize delta: `-1 col`
- wait after first resize: `150ms`
- wait after restore: `250ms`

### Snapshot output

```ts
interface TerminalSnapshot {
  snapshotId: string;
  channelId: string;
  sessionId: string;
  reason: 'before-send' | 'after-complete' | 'manual';
  cols: number;
  rows: number;
  capturedAt: string;
  source: 'headless-mirror';
  serializationFormat: 'xterm-screen-v1';
  screenText: string;
  screenRevision: number;
  lineCount: number;
  hash: string;
}
```

## 7.3 Input delivery

- Discord メッセージ本文を terminal に入力
- 末尾に `Enter` を送る
- Discord では即時に `processing` リアクションを付与

### Input normalization

- Discord markdown はそのまま送らない
- bot mention は削除
- コードブロックは内容だけ送る
- 改行は保持
- 許可されていない user ID の発言は無視する
- bot 自身の発言は無視する
- 対象チャンネル内の **全発言** を入力対象とする
- 許可されていない channel ID の発言は無視する

### Supported Discord control commands

- 通常テキスト入力とは別に、**制御キー送信用の予約コマンド**を受け付ける
- v1 の予約トークンは **メッセージ全文一致**で判定する:
  - `[[terminal:ctrl-c]]`
  - `[[terminal:esc]]`
  - `[[terminal:enter]]`
  - `[[terminal:stop]]`
- `[[terminal:ctrl-c]]` / `[[terminal:esc]]` / `[[terminal:enter]]` は **通常の key injection** として扱う
- `[[terminal:stop]]` は **abort 専用 command** として扱い、通常入力 queue へは入れない
- 制御キーコマンドに一致した場合は、本文を literal text として送らず、対応する key event または stop API を実行する
- `[[terminal:enter]]` 単体コマンドは、空入力での再実行やプロンプト送りを許可する

### Event scope

- v1 では **通常メッセージ本文のみ**を入力対象にする
- message edit / delete は terminal へ反映しない
- attachment / embed / sticker / reaction は入力対象外
- reply metadata や引用 UI は自動展開せず、本文文字列だけを見る

## 7.4 Completion detection

ユーザー要求は「**リアクション後、terminal の表示変化がなくなったら完了**」だが、これだけでは誤判定しやすい。  
そのため、以下の複合条件にする。

### Completion reason

```ts
type CompletionReason =
  | 'prompt_ready'
  | 'idle_stable'
  | 'soft_timeout_stable'
  | 'no_output_timeout'
  | 'hard_timeout_failed'
  | 'aborted';
```

### Completion condition

通常の text input は次を満たした時に success completion とする:

1. 最後の terminal buffer 変化から `settleMs` 以上経過
2. `stablePollCount` 回連続で snapshot hash が変化していない
3. `minimumObservedOutputEvents = 1` は **通常 text input の補助条件**としてのみ使う
4. 追加で次のどちらか
   - shell integration 上の prompt ready を検出
   - `softTimeoutMs` を超え、かつ snapshot hash が安定している

control command や no-output command は別ルールにする:

- `[[terminal:esc]]` / `[[terminal:enter]]` / 出力なし成功コマンドでは、`minimumObservedOutputEvents` を必須にしない
- prompt ready の再検出、または `noOutputTimeoutMs` 経過で success completion を許可する
- `hardTimeoutMs` 到達は **success ではなく failure** とする

### Default values

- `settleMs = 2000`
- `softTimeoutMs = 20000`
- `noOutputTimeoutMs = 3000`
- `hardTimeoutMs = 120000`
- `pollIntervalMs = 500`
- `stablePollCount = 3`
- `minimumObservedOutputEvents = 1`

### Observed mutation source

- PTY data event
- xterm screen revision increment
- serialized snapshot hash の変化

### Recommended implementation note

誤判定を減らすため、完了判定は **event-driven idle** と **poll-driven stable hash** の二層で行う。

1. PTY data event で `lastActivityAt` を更新
2. 500ms ごとに snapshot hash を再計算
3. `stablePollCount` 回連続で hash 不変なら stable とみなす
4. stable かつ `settleMs` 経過で完了候補
5. prompt ready が見えていれば即採用
6. prompt ready が無くても `softTimeoutMs` 超過後に stable なら採用
7. control command / no-output command では `noOutputTimeoutMs` と prompt ready を優先する

### Session state required for completion

- `lastActivityAt`
- `screenRevision`
- `lastPromptReadyAt`
- `lastSnapshotHash`
- `observedOutputEvents`
- `lastRawOutputOffset`

### Important restriction

- 完了待機中は、判定目的だけの resize jiggle を行わない
- redraw 誘発は **before snapshot / after snapshot** の採取タイミングに限定する
- 完了判定は screen activity / raw output activity と prompt signal だけで進める

## 7.5 Post-complete redraw and snapshot

入力前と同じ resize jiggle を行う。

1. resize -> restore
2. wait
3. `afterSnapshot` を採取

## 7.6 Diff extraction

### Goal

Discord に返すのは **terminal 全文** ではなく、**入力後に新規追加または変化した内容**。

### Recommended algorithm

1. input 送信時に次の marker を保存する:
   - `beforeScreenRevision`
   - `beforeRawOutputOffset`
   - `beforePromptReadyAt`
2. reply 候補を次の順で組み立てる:
   - `beforeRawOutputOffset` 以降に出た raw output
   - `beforeSnapshot.screenText` と `afterSnapshot.screenText` の tail 10000 比較差分
   - `afterSnapshot.screenText` の末尾 N 行
3. raw output が有効で十分ならそれを優先する
4. raw output が空またはノイジーなら screen diff を使う
5. 両方が弱い場合のみ、`afterSnapshot` の末尾 N 行を fallback とする

### Normalization rules

- 行末空白削除
- `\r\n` を `\n` に統一
- 連続空行の圧縮は**しない**
- ANSI escape は除去する
- timing/spinner 行は必要なら除外可能
- 末尾 10000 文字の切り出しは **正規化前** に行う
- v1 の fallback は **`afterSnapshot.screenText` の末尾 N 行のみ**とし、意味的 block 抽出は行わない

### Output shape

```ts
interface TerminalDiffResult {
  beforeSnapshotId: string;
  afterSnapshotId: string;
  diffText: string;
  diffLineCount: number;
  wasFallbackUsed: boolean;
}
```

## 7.7 Discord reply

### Reply rules

- 基本は code block で返信
- `diffText` は最大 10000 文字を比較対象にする
- Discord 返信は **1 message あたり 1900 文字以内、最大 5 メッセージ** まで送る
- 実装上の本文 chunk target は **1800 文字前後** とし、code fence や note の余白を確保する
- 各 chunk は **独立した code fence** で閉じる
- diff 内の triple backtick は fence 崩れを防ぐため escape または代替 fence で処理する
- 5 メッセージに収まらない場合は **先頭側から安全に切り詰め、truncated note を付ける**

### Truncated note

```text
[truncated: diff exceeded Discord reply limit]
```

### Reaction rules

- 受付時: `👀` or `⏳`
- queue 待機時: `🕒`
- 成功時: `✅`
- timeout / failure: `⚠️` or `❌`
- cancelled / rejected: `🚫`

## 8. Data persistence

## 8.1 Persisted data

### Channel registry

```ts
interface ChannelSessionBinding {
  channelId: string;
  sessionId: string;
  status: 'active' | 'busy' | 'dead';
  createdAt: string;
  updatedAt: string;
}
```

### Snapshot archive

- 保存先例: `app.getPath('userData')\\discord-bridge\\snapshots\\`
- ファイル名例: `{channelId}-{timestamp}-{reason}.json`
- canonical snapshot として `screenText` / `screenRevision` / `hash` を保存する
- raw transcript は別保存してよいが、用途は audit / debug / fallback に限定する
- screen diff 計算は保存済み snapshot のうち **末尾 10000 文字**のみを使用する

### Processing logs

- messageId
- channelId
- sessionId
- requestState
- startedAt
- finishedAt
- completionReason
- diff length
- timeout flag

## 9. API additions required in current app

現行コードに対して追加が必要な API:

| API | Direction | Purpose |
| --- | --- | --- |
| `terminal:get-buffer-snapshot(sessionId)` | IPC | canonical screen snapshot 取得 |
| `terminal:get-session-state(sessionId)` | IPC | revision / prompt / activity / ownership 取得 |
| `terminal:get-dimensions(sessionId)` | IPC | 現在の cols/rows 取得 |
| `terminal:redraw-jiggle(sessionId)` | IPC | resize -> restore の自動化 |
| `terminal:send-input(sessionId, content)` | IPC | text input 送信 |
| `terminal:send-key(sessionId, key)` | IPC | ctrl-c / esc / enter の key injection |
| `terminal:stop-request(sessionId)` | IPC | priority stop path |
| `terminal:wait-for-completion(sessionId, options)` | IPC/service | completion reason 付き完了待機 |
| `discord:start-bridge(config)` | internal | bot 接続開始 |
| `discord:stop-bridge()` | internal | bot 停止 |

## 10. State machine

```text
received
  -> queued
  -> running
  -> aborting
  -> completed
  -> failed
  -> rejected
  -> cancelled
```

### Error states

- `session_missing`
- `snapshot_failed`
- `hard_timeout_failed`
- `discord_send_failed`
- `pty_disconnected`
- `write_rejected`

## 11. Major problem points

## 11.1 “Resize for redraw” is not deterministic

最大の問題点。  
`gemini-cli` のような TUI は resize で再描画されるが、**常に同じ内容へ収束する保証はない**。

### Impact

- before/after の比較がノイジーになる
- 一部表示が消える/増える
- 行折返し差分が意味差分に混ざる

### Mitigation

- snapshot 比較は raw transcript ではなく **fixed-size xterm screen snapshot** を基準に行う
- completion 判定に prompt / idle / timeout を併用する
- line wrap 差分を極力除外する
- bridge-managed session では PTY と renderer xterm を同じ fixed size に揃える
- redraw jiggle は snapshot 採取前後に限定し、待機中ポーリングのためには使わない

## 11.2 Current app does not keep a full transcript

現行実装では `session-data` を renderer に流して描画しているだけで、**scrollback 含む完成 transcript** を取り出す仕組みが無い。

### Required fix

- xterm buffer serialize
  または
- headless xterm mirror

## 11.3 Current renderer scrollback is finite

現行 `TerminalViewport.tsx` では `scrollback: 5000`。  
これは「scrollback 含む全テキスト取得」と言っても **無限ではない**。

### Required decision

- 十分大きい scrollback でよいか
- それとも raw transcript を別途永続保存するか

**方針: canonical snapshot は screen state、raw transcript は補助情報として別保持する。**

## 11.4 “Display stopped changing” is a weak completion signal

CLI によっては:

- spinner が止まる
- 一瞬静かになる
- prompt が出る前に停止する
- バックグラウンド更新が後から来る

### Mitigation

- idle だけに依存しない
- prompt ready / timeout と複合判定にする
- transcript hash の連続安定確認を追加する
- `hard_timeout` は failure 扱いにする
- no-output command では `noOutputTimeoutMs` を別ルールにする

## 11.5 Diff of full terminal text is noisy

全 transcript を単純 diff すると:

- 折返し変更
- prompt の再描画
- 進捗行の上書き
- TUI の再配置

が差分として大量に出る。

### Mitigation

- 共通 prefix/suffix カット
- ANSI 除去
- optional: spinner/progress 行の除去
- fallback を用意
- 比較対象を末尾 10000 文字に限定する
- fallback は `afterSnapshot.screenText` の末尾 N 行に限定する

## 11.6 Discord message size limit

- 返信差分が大きいと 2000 文字を超える
- code block の backtick 崩れも起きる

### Mitigation

- 分割送信
- 1900 文字 x 5 メッセージ上限
- 超過分は truncate note 付きで打ち切る

## 11.7 Security risk

Discord チャンネルから terminal に直接入力するため、**そのチャンネルの参加者はローカル terminal を操作できる**。

### Required controls

- env による許可ユーザー ID 制限
- 許可チャンネル制限
- audit log
- 危険コマンド制限の検討

### Current stance

- 開発段階では、厳格な command filter や秘匿化よりも操作成立を優先する
- 初期実装の最低ラインは `ALLOW_USER_IDS`、`ALLOW_CHANNEL_IDS`、操作ログ記録
- より強い漏洩対策は運用結果を見て段階的に追加する

## 12. Resolved decisions

1. チャンネル内の**全発言**を terminal 入力対象にする
2. `ALLOW_USER_IDS` と `ALLOW_CHANNEL_IDS` を env で設定し、許可された user/channel のみ処理する
3. canonical snapshot は **fixed-size xterm screen state** とし、raw transcript は補助用途に下げる
4. 差分計算は **raw output marker + tail 10000 screen diff + after tail fallback** の順で組み立てる
5. Discord 返信は **1 message 1900 文字以内 / 最大 5 メッセージ** とし、実装 chunk target は 1800 文字前後にする
6. 完了判定は **idle + stable hash + prompt/timeout** の複合判定だが、control/no-output command は別ルールにする
7. `hard_timeout` は success completion ではなく failure として扱う
8. bridge-managed session では PTY と renderer xterm の論理サイズを固定し、window resize で resize sync しない
9. redraw / flicker を許容するのは before / after snapshot の各 1 回のみとする
10. Discord 処理中や terminal busy 中は Electron UI からの入力を禁止し、**main 側 write gate** でも拒否する
11. stop は `[[terminal:stop]]` の priority control path とし、通常 `Ctrl+C` key injection とは分離する
12. stop / hard stop / session death 時、queued request は v1 では `cancelled` として破棄する
13. 複雑な TUI 互換は best-effort とし、主対象は AI CLI とする
14. 開発段階の情報漏洩対策は最低限のアクセス制御を優先する
15. 1 チャンネルあたりの queue 上限は **待機 1 件** とする
16. Discord から `[[terminal:ctrl-c]]` / `[[terminal:esc]]` / `[[terminal:enter]]` の key injection を許可する
17. v1 の入力対象は **通常メッセージ本文のみ**とし、edit / delete / attachment / embed は無視する

## 13. Recommended implementation order

1. snapshot spike
2. shared contracts + bridge session ownership
3. fixed-size terminal + main-side write gate
4. transcript / snapshot / prompt state
5. local automation engine
6. channel queue + stop priority path
7. Discord bridge
8. UI state wiring + final hardening

## 14. Recommended first milestone

最初のマイルストーンは次。

> local runner で 1 input 送信 -> completion reason 判定 -> after snapshot / raw output 取得 -> 返信候補を構築

その次に:

1. before snapshot
2. post-redraw
3. channel queue
4. Discord reaction / reply 制御

の順で積むのが安全。
