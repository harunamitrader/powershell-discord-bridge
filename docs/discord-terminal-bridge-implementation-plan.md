# Discord terminal bridge implementation plan

## 1. Problem

既存の Electron terminal アプリを拡張し、Discord bot から **1 channel = 1 terminal session** で操作できるようにする。  
その際、before / after snapshot を安定取得し、差分を Discord に返し、Discord 実行中は Electron UI 側の送信操作と競合しないようにする。

## 2. Current baseline

- PowerShell PTY セッション
- xterm.js による描画
- 複数 terminal tab
- basic shell integration
- terminal data / exit event 配信

未実装の中心は次の通り。

- transcript / snapshot 取得
- completion detection
- diff extraction
- Discord bot bridge
- channel queueing
- UI lock / stop control

## 3. Confirmed scope

- `1 Discord channel = 1 terminal session`
- 許可ユーザーは `ALLOW_USER_IDS` で制限
- 許可チャンネルは `ALLOW_CHANNEL_IDS` で制限
- PTY 論理サイズは `120 x 32` 固定
- redraw jiggle は before / after snapshot 時のみ
- queue 上限は `1 in-flight + 1 queued`
- Discord から `[[terminal:ctrl-c]]` / `[[terminal:esc]]` / `[[terminal:enter]]` の予約コマンド送信を許可
- `[[terminal:stop]]` は通常入力と別の priority stop path とする
- v1 の入力対象は通常メッセージ本文のみ
- 複雑な TUI 互換は best-effort、主対象は AI CLI
- canonical snapshot は fixed-size xterm screen state とし、raw transcript は補助用途に留める

## 4. Implementation strategy

外側からではなく、**terminal 状態の安定取得** から先に作る。

1. snapshot 方式を小さく検証して canonical source を固める
2. shared contract / ownership / write policy を拡張する
3. fixed-size terminal と write gate を入れる
4. transcript / snapshot / prompt state 基盤を入れる
5. local automation pipeline を作る
6. channel queue と priority stop path を作る
7. Discord bridge を載せる
8. 最後に UI state と hardening を仕上げる

この順にすることで、completion 判定や diff の難所を Discord 非依存で先に詰められる。

## 5. Delivery phases

### Phase 0: snapshot spike

[Step] Gemini CLI など実対象で、snapshot 方式と redraw jiggle 後の安定性を小さく検証する。canonical snapshot は fixed-size xterm screen state を前提にし、backing 実装を headless mirror で確定できるか確認する。  
[Verification] canonical snapshot source、raw transcript の役割、screen diff の使い所を 1 つに決められる。

### Phase 1: shared contracts and bridge session ownership

[Step] shared type、preload contract、main 側 config 読み込みを拡張し、bridge state、control command、queue status、stop reason、completion reason、Discord env、bridge session ownership を扱えるようにする。  
[Verification] main / preload / renderer の型が揃い、bridge session と normal session の違い、write policy、resize policy を型で表現できる。

### Phase 2: fixed-size terminal and write gate

[Step] bridge 管理 session では PTY と renderer xterm を fixed-size にし、FitAddon resize sync を止め、main 側 write gate で local keyboard / paste を busy 中に拒否する。stop API だけは例外で通す。  
[Verification] bridge-managed session では window resize で PTY resize が発生せず、busy 中の local write は main 側で拒否される。

### Phase 3: transcript / snapshot / prompt state

[Step] visible viewport とは独立した canonical snapshot、raw transcript、screen revision、snapshot hash、lastActivityAt、promptReady state を保持できるようにする。  
[Verification] Discord なしで before/after snapshot、hash、promptReady、lastActivityAt、raw output marker を取得できる。

### Phase 4: local automation pipeline

[Step] redraw jiggle、text/key injection、before/after capture、completion detection、diff extraction、reply chunking、soft/hard stop をローカル service として実装する。control/no-output command と hard-timeout failure を分ける。  
[Verification] Discord を使わなくても input -> wait -> snapshot -> diff の一連処理が実行でき、`Ctrl+C` / `Esc` / `Enter` / no-output / timeout を local runner で確認できる。

### Phase 5: channel registry, bounded queueing, and priority stop

[Step] `ChannelSessionRegistry` と channel ごとの execution state を実装し、`received` / `queued` / `running` / `aborting` / `completed` / `failed` / `rejected` / `cancelled`、1 件待機 queue、overflow reject、priority stop、queued cancellation、hard stop 後の session recreate を扱えるようにする。  
[Verification] 1 件実行中 + 1 件待機が動作し、3 件目は reject され、stop が queue を待たず in-flight に効き、queued request は仕様どおりに処理される。

### Phase 6: Discord bridge service

[Step] Discord bot client、allowed-user filter、allowed-channel filter、message normalization、reaction 更新、reply 送信、bridge start/stop を local automation pipeline の上に実装する。  
[Verification] 許可 user / channel の message だけが正しい session に流れ、未許可 traffic は無視され、返信サイズ制限と code fence 制約も守られる。

### Phase 7: renderer lock state and end-to-end hardening

[Step] bridge busy state を UI に反映し、Discord 実行中は local send 系入力を無効化しつつ、表示・選択・コピー・スクロールは許可し、stop は常に叩けるようにする。そのうえで AI CLI の通常応答、no-output timeout、queue overflow、control commands、soft stop、hard stop fallback、restart/recovery を通しで確認する。  
[Verification] happy path と主要 failure path が仕様書どおりに収束する。

## 6. Todo plan

1. **bridge-snapshot-spike**  
   canonical snapshot source、raw transcript の役割、redraw jiggle の安定性を小さく検証する。

2. **bridge-shared-contracts**  
   bridge 用 shared type、env/config 読み込み、IPC contract、ownership / write policy / completion reason を追加する。

3. **bridge-fixed-size-terminal**  
   bridge 管理 session の PTY / renderer xterm を固定化し、FitAddon resize sync を止め、redraw jiggle を explicit automation API だけから使えるようにする。

4. **bridge-write-gate**  
   busy 中の local write 拒否と stop 例外通過を main 側で実装する。

5. **bridge-transcript-snapshots**  
   canonical snapshot、raw transcript、revision/hash tracking、prompt/activity state、snapshot persistence を実装する。

6. **bridge-automation-engine**  
   text/key injection、completion detection、diff extraction、reply chunking、soft/hard stop orchestration を実装する。

7. **bridge-channel-queue**  
   channel-session binding、1 in-flight + 1 queued、priority stop、queued cancellation、hard stop 後 recovery を実装する。

8. **bridge-discord-service**  
   Discord bot、allowed-user/channel filter、reaction、reply、bridge lifecycle を追加する。

9. **bridge-ui-lock-stop**  
   bridge 実行中の UI lock、busy state 表示、stop 操作を追加する。

10. **bridge-validation**  
    main scenario を通して edge case を調整する。

## 7. Dependencies

- `bridge-shared-contracts` depends on `bridge-snapshot-spike`
- `bridge-fixed-size-terminal` depends on `bridge-shared-contracts`
- `bridge-write-gate` depends on `bridge-shared-contracts`
- `bridge-transcript-snapshots` depends on `bridge-fixed-size-terminal` and `bridge-write-gate`
- `bridge-automation-engine` depends on `bridge-transcript-snapshots`
- `bridge-channel-queue` depends on `bridge-automation-engine`
- `bridge-discord-service` depends on `bridge-channel-queue`
- `bridge-ui-lock-stop` depends on `bridge-write-gate` and `bridge-discord-service`
- `bridge-validation` depends on `bridge-ui-lock-stop`

## 8. Notes

- completion 判定と diff の検証は、まず local automation だけで詰める
- redraw jiggle は polling には使わず、snapshot 前後だけに限定する
- bridge 未使用時の desktop terminal UX はなるべく維持する
- main 側 write gate が排他の最終保証であり、renderer 側 lock は UX の補助とみなす
- stop command と通常 `Ctrl+C` key injection は混同しない
