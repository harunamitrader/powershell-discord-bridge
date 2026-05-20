# Advanced: Local AI to slot text send

This is an **advanced local automation feature**.  
The normal workflow is still **sending messages from Discord to each slot**, and this feature is not meant to replace that.

## What it does

It provides the smallest possible local AI handoff: **send `slot + text + optional Enter`** from a local AI CLI or shell into the running Electron app.

- slots are `slot1-slot4`
- text is sent as plain text
- Enter can be omitted when needed
- the target slot is activated in the app before sending
- the feature does not depend on which AI or tool is running inside the slot

## Preconditions

1. The `powershell-discord-bridge` Electron app must already be **running**
2. The command must run on the same Windows machine
3. Node.js must be available so the repo CLI can run

This feature is **local-only**.  
If the app is not running, the CLI fails clearly.

## Manual usage

### 1. Send a one-line text

```powershell
npm run slot:send -- --slot slot3 --text "Review this diff"
```

By default, this command also performs a lightweight **delivery likelihood check** a few seconds later.
It returns one of `likely_delivered`, `uncertain`, or `likely_not_delivered`, which only estimates whether the input probably reached the target. It does not track the final outcome.

### 2. Send without Enter

```powershell
npm run slot:send -- --slot slot3 --text "draft only" --no-enter
```

### 3. Send multi-line text

```powershell
@'
line 1
line 2
'@ | node .\scripts\bridge-send-slot.cjs --slot slot4
```

## CLI shape

- `--slot`: required. `1-4` or `slot1-slot4`
- `--text`: optional. If omitted, the CLI reads from `stdin`
- `--no-enter`: optional. Skips the trailing Enter
- `--notify-on-complete`: optional. **Off by default**. Enable only when the sender slot needs a completion callback
- `--origin-slot`: optional. Required only when `--notify-on-complete` is used
- `--json`: optional. Prints the accepted response as JSON
- `--client`: optional. Adds a client label for logs

### 4. Send a completion callback back to the sender slot

Only when needed, the bridge can inject a fixed task-complete message into the sender AI's slot.
This is **off by default even for skill-driven sends** and should be enabled only when the AI decides it truly needs the callback or when the user explicitly asks for it.

```powershell
npm run slot:send -- --slot slot3 --text "Let me know when this is done" --notify-on-complete --origin-slot slot2
```

- the completion callback is injected into `slot2` as a fixed terminal message
- `--notify-on-complete` only works together with `--origin-slot`
- it cannot be combined with `--no-enter`

## Additional observe commands

Only when the user asks for confirmation, the AI can call these on-demand observe actions.

### Check visible slot text

```powershell
npm run slot:observe -- --slot slot3 --text
```

This visible text keeps **visual wrap boundaries as line breaks**, which makes it a better first choice than screenshots when you want to inspect table-like or list-like terminal output.

### Check a slot screenshot (`!ss` equivalent)

```powershell
npm run slot:observe -- --slot slot3 --screenshot
```

PNG files are saved under `%APPDATA%\PowerShell Discord Bridge\automation-captures\...`, and the CLI returns the saved path as JSON.

### Check the whole app window screenshot (`!wss` equivalent)

```powershell
npm run slot:observe -- --window-screenshot
```

If the AI needs to understand other slots, it can simply fetch each slot's visible text one slot at a time. A dedicated summary feature is not required.

## Using it through a skill

This repo is designed so a skill can simply call the `slot:send` and `slot:observe` CLIs.
That keeps `AGENTS.md` clean while still letting an AI follow requests such as “send this text to slot3”.

### Example: Copilot skill setup

1. Create this folder:

```text
C:\Users\<your-user>\.copilot\skills\powershell-discord-bridge-slot-send
```

2. Copy this template from the repo into that folder as `SKILL.md`:

```text
docs\skill-examples\powershell-discord-bridge-slot-send\SKILL.md
```

3. Then ask Copilot in natural language:

- `Send "Review this diff" to slot3`
- `Send "draft only" to slot4 without Enter`

Internally, the skill calls:

```powershell
npm run slot:send -- --slot slot3 --text "Review this diff"
```

Completion callbacks stay **off by default in the skill**.
Only opt in when another slot AI genuinely needs the callback:

```powershell
npm run slot:send -- --slot slot3 --text "Notify me when you finish" --notify-on-complete --origin-slot slot2
```

Only when needed, it can also call:

```powershell
npm run slot:observe -- --slot slot3 --text
npm run slot:observe -- --slot slot3 --screenshot
npm run slot:observe -- --window-screenshot
```

### If another AI CLI supports skills

Use the same pattern:

- choose exactly one slot
- keep the text unchanged
- add `--no-enter` only when needed
- add `--notify-on-complete --origin-slot ...` only when a sender-slot callback is genuinely needed
- internally call `npm run slot:send -- ...` or `node .\scripts\bridge-send-slot.cjs ...`

## Recommended usage split

- **Normal workflow**: send from Discord
- **Advanced automation**: call `slot:send` from a skill or local shell

Start with **plain text send only**.  
Higher-level concepts such as review, handoff, or orchestration should be layered on top later.

## Troubleshooting

### The Electron app was not found

The app is not running yet.  
Start `powershell-discord-bridge` first, then run the command again.

### I want text to appear without pressing Enter

Use `--no-enter`.

### I want to send multiple lines

Use `stdin` instead of `--text`.
