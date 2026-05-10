# Discord terminal bridge document review

対象:

- `C:\Users\sgmxk\Desktop\AI\repos\github\harunamitrader\powershell-discord-bridge\docs\discord-terminal-bridge-spec.md`
- `C:\Users\sgmxk\Desktop\AI\repos\github\harunamitrader\powershell-discord-bridge\docs\discord-terminal-bridge-implementation-plan.md`

## Critical issues

### 1. Snapshot source が未確定のまま

仕様書では snapshot 取得方式として「renderer xterm buffer serialize」または「main 側 headless mirror」を候補にしつつ、後段では raw transcript を別保持する方針も出ている。

これは同じものではない。raw transcript は append-only なログなので、TUI のカーソル移動、行上書き、画面消去、alternate screen を screen state として復元できない。diff や completion detection の基準に raw transcript を使うと、AI CLI/TUI 系では後から大きく作り直す可能性が高い。

修正案:

- v1 の canonical snapshot を「fixed-size xterm buffer state の serialization」に固定する。
- raw transcript は監査ログ、デバッグ、fallback 用途に下げる。
- headless mirror を採るなら、`@xterm/headless` 相当の依存、raw PTY data を mirror に流す責務、renderer xterm との同期範囲を仕様に明記する。

### 2. UI lock が renderer 側だけだと破綻する

現行実装では renderer の xterm `onData` が直接 `window.terminalApp.write(sessionId, data)` を呼び、main 側 IPC は無条件で PTY に書き込む構造になっている。

そのため、ボタンや Enter 送信を無効化しても、xterm へのキーボード入力や paste 経路が残る。Discord 実行中に local input が混ざると、before/after snapshot、completion detection、queue の整合性が崩れる。

修正案:

- UI lock は renderer の表示制御だけでなく、main 側 `write(sessionId, data)` で enforcement する。
- bridge-owned かつ busy な session への local write は main 側で拒否する。
- stop 操作だけは別 API / 別権限として許可する。
- 実装計画では Phase 6 では遅い。fixed-size/session ownership と同じ Phase 2 か、遅くとも local automation の Phase 3 で入れる。

### 3. fixed-size terminal と renderer/xterm の責務分離が曖昧

仕様では PTY を `120x32` 固定にするとしているが、現行 renderer は `FitAddon` と `ResizeObserver` で viewport サイズに合わせて resize を送り続ける。

PTY だけを固定し、renderer xterm の cols/rows が viewport に合わせて変わると、折返し、screen buffer、snapshot、見た目がずれる。これは diff のノイズだけでなく、renderer と headless mirror の状態不一致にもつながる。

修正案:

- bridge-managed session では PTY と renderer xterm の論理サイズをどちらも `120x32` に固定する。
- `FitAddon` による resize sync を bridge-managed session では無効化する。
- Electron 側は terminal surface を固定サイズとして扱い、外側 DOM のスクロールで閲覧させる。
- 通常 desktop terminal session と bridge-managed session の resize policy を明確に分ける。

### 4. completion detection が no-output / prompt-only / control-key 系で詰まる

仕様では `minimumObservedOutputEvents = 1` が条件に入っている。これだと以下のケースで hard timeout まで待つ可能性がある。

- `Enter` 単体で何も出力されない
- `Esc` だけを送る
- shell prompt が即時に戻る
- コマンドが出力なしで成功する
- AI CLI が短時間だけ静かになった後、まだ処理中

また、現行コードの shell integration は `promptReady` を parser で検出しているが、session manager が promptReady event / lastPromptAt として保持していない。

修正案:

- completion reason を分ける。
  - `prompt_ready`
  - `idle_stable`
  - `soft_timeout_stable`
  - `no_output_timeout`
  - `hard_timeout_failed`
  - `aborted`
- `minimumObservedOutputEvents` は通常 text input の補助条件に留め、control command や no-output command では別ルールにする。
- promptReady を session state として保持し、automation service から参照できるようにする。
- hard timeout は「完了」ではなく failure / timeout として扱う。

### 5. Discord からの stop と通常 Ctrl+C 入力が衝突している

仕様では `Ctrl+C` を通常 control command と soft stop の両方に使うとしている。しかし、処理中に Discord から `Ctrl+C` が来た場合に、queued request として扱うのか、in-flight request の abort として扱うのかが未定義。

ここを曖昧にすると、queue、reaction、snapshot、session recovery が絡んで後から直しづらい。

修正案:

- stop は通常入力 queue をバイパスする priority control path にする。
- 通常の `Ctrl+C` key injection と「現在の request を stop する command」を別トークンにする。
- stop 実行時に queued request を破棄するのか保持するのかを明記する。

## Important issues

### 1. 実装順序が仕様書と実装計画で食い違っている

仕様書の推奨実装順は `ChannelSessionRegistry` が先頭だが、実装計画では terminal 状態の安定取得を先にしている。

方針としては実装計画の方が妥当。Discord や channel queue よりも、snapshot/completion/diff を local automation として検証できる状態を先に作るべき。

修正案:

- 仕様書の実装順を実装計画に合わせる。
- ただし UI lock と fixed-size mode は snapshot 基盤より前、または同じ phase で入れる。

### 2. channel allowlist が v1 必須になっていない

仕様の前提では `ALLOW_USER_IDS` が中心だが、security risk の章では許可チャンネル制限が最低ラインに含まれている。

「対象チャンネル内の全発言を terminal 入力対象にする」設計なら、user allowlist だけでは誤爆リスクが高い。bot が参加している別チャンネルで想定外に動くと危険。

修正案:

- `ALLOW_CHANNEL_IDS` を v1 の必須 env にする。
- channel binding は `ALLOW_CHANNEL_IDS` に含まれる channel でのみ作成する。
- 未許可 channel の message は完全無視する。

### 3. queue の状態遷移が足りない

仕様には `1 in-flight + 1 queued` はあるが、以下が未定義。

- queued request に reaction を付けるか
- queued request がある状態で stop したらどうするか
- hard stop 後に queued request を新 session に流すか
- in-flight が failure した場合に queued を続行するか
- queued request の user が許可状態から外れた場合にどうするか

修正案:

- request state を明示する。
  - `received`
  - `queued`
  - `running`
  - `aborting`
  - `completed`
  - `failed`
  - `rejected`
  - `cancelled`
- stop 時の queued request は v1 では破棄する方が単純で安全。
- hard stop 後は queued request を自動実行せず、明示的に cancelled/retry 案内を返す方が事故が少ない。

### 4. diff が tail 10000 文字の prefix/suffix 差分だけだとノイズに弱い

tail 10000 文字で切った後に common prefix/suffix を取る方式は単純だが、tail window の境界次第で共通 prefix が消え、ほぼ全文差分になることがある。

また、TUI の redraw は「新規追加」ではなく「既存画面の置換」になるため、screen snapshot 差分だけではユーザーが欲しい応答部分を取り出しづらい。

修正案:

- input 送信時の `screenRevision` / `rawOutputOffset` / `promptReadyAt` を保存する。
- 返信候補は以下を併用する。
  - 送信後に発生した raw output
  - after screen snapshot の末尾
  - before/after screen diff
- v1 の fallback は「after snapshot の末尾 N 行」に固定し、`last assistant block` のような意味的抽出は後回しでよい。

### 5. Discord code block 分割の仕様が甘い

1900 文字単位とあるが、code fence、truncated note、backtick escaping 分の余白が必要。

修正案:

- diff 本体は 1800 文字程度で chunk する。
- 各 chunk ごとに code fence を閉じる。
- diff 内に triple backtick がある場合は fence を崩さない escaping または代替 fence を使う。
- truncated note を含めた最終 message が 2000 文字以内に収まるようにする。

## Open questions

- v1 の canonical snapshot は headless mirror ですか、それとも renderer xterm serialize ですか。
- bridge session は既存 UI tab と同じ session を使いますか、Discord 専用 session として作りますか。
- hard stop 後、CWD、環境変数、起動中の Gemini CLI 状態は復元対象ですか。
- snapshot / raw transcript / processing log の保存期間、最大サイズ、秘匿情報の扱いはどうしますか。
- Discord の予約コマンド記法は何にしますか。
- queued request に reaction / reply をいつ返しますか。
- timeout 後も terminal process が動き続けている場合、session を busy のままにしますか、それとも active に戻しますか。

## Suggested spec changes

1. canonical snapshot source を「fixed-size xterm buffer state」と明記する。
2. raw transcript は canonical snapshot ではなく、監査ログ/補助情報として位置付ける。
3. `ALLOW_CHANNEL_IDS` を v1 必須にする。
4. stop を通常入力 queue と別の priority control path にする。
5. completion reason を明示的な enum として定義する。
6. hard timeout は success completion ではなく timeout/failure として扱う。
7. bridge-managed session では renderer xterm も固定 cols/rows にし、FitAddon resize を止めると明記する。
8. queue overflow、stop 時 queued request、session death 時 queued request の扱いを状態表に追加する。
9. Discord reply chunking で code fence と backtick escaping を仕様化する。
10. v1 の diff fallback を単純な「after snapshot 末尾 N 行」に絞る。

## Suggested implementation plan changes

### Phase 0: snapshot spike

実装前に、Gemini CLI など実対象で snapshot 方式を検証する。

[Step]

- renderer xterm serialize と headless mirror のどちらを使うかを小さく検証する。
- resize jiggle 後の before/after snapshot が安定するか確認する。
- TUI redraw、spinner、alternate screen、長文出力で差分がどう見えるか確認する。

[Verification]

- canonical snapshot 方式を 1 つに決められる。
- raw transcript と screen snapshot の役割を分離できる。

### Phase 1: shared contracts and bridge session ownership

既存 plan の shared contracts に加え、bridge-managed session の所有権、write policy、resize policy を定義する。

[Verification]

- bridge session / normal session の違いが型で表現できる。
- local write を main 側で拒否できる設計になっている。

### Phase 2: fixed-size terminal and write gate

fixed-size PTY、renderer xterm fixed-size mode、FitAddon 無効化、main-side write gate を同時に入れる。

[Verification]

- bridge-managed session では window resize で PTY resize が発生しない。
- local keyboard/paste が busy 中に PTY へ流れない。
- stop API だけは busy 中も動く。

### Phase 3: transcript/snapshot/prompt state

snapshot capture に加えて、session manager が last activity、revision、promptReady を保持する。

[Verification]

- Discord なしで before/after snapshot、hash、promptReady、lastActivityAt を取得できる。

### Phase 4: local automation engine

input injection、completion detection、diff、reply chunking、soft/hard stop を Discord なしで検証可能にする。

[Verification]

- no-output、prompt-only、long output、timeout、Ctrl+C、Esc、Enter のケースが local runner で確認できる。

### Phase 5: channel queue and stop priority path

channel binding、bounded queue、overflow reject、priority stop、queued cancellation を実装する。

[Verification]

- 1 in-flight + 1 queued が守られる。
- stop が queue を待たず in-flight に効く。
- stop 後の queued request の扱いが仕様通りになる。

### Phase 6: Discord bridge

Discord bot、allowed user/channel filter、message normalization、reaction、reply、bridge lifecycle を載せる。

[Verification]

- 許可 channel/user の message だけが session に流れる。
- 未許可 user/channel は無視される。
- reply size と code fence が Discord 制限内に収まる。

### Phase 7: end-to-end hardening

AI CLI の通常応答、no-output timeout、queue overflow、control commands、soft/hard stop、restart/recovery を通しで確認する。

[Verification]

- happy path と主要 failure path が仕様通りに収束する。

## Final verdict

このまま全面実装に入るのはまだ危険。

方向性は良いが、後から直すと痛い設計点が残っている。特に危険なのは次の 4 つ。

- snapshot の正体が未確定
- renderer/xterm と PTY の fixed-size 同期が未定義
- UI lock が main 側 enforcement になっていない
- stop と queue の優先制御が曖昧

先に仕様修正すべき。上記 4 点を固めれば、v1 は十分現実的に実装できる。

推奨する次アクション:

1. snapshot source を決める。
2. bridge-managed session の resize/write policy を明文化する。
3. stop command と normal control command を分離する。
4. queue/timeout/session death の状態遷移を仕様に追加する。
5. その後、local automation runner から実装を始める。
