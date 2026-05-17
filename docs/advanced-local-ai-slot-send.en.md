# Advanced: Local AI to slot text send

This is an **advanced local automation feature**.  
The normal workflow is still **sending messages from Discord to each slot**, and this feature is not meant to replace that.

## What it does

It provides the smallest possible local AI handoff: **send `slot + text + optional Enter`** from a local AI CLI or shell into the running Electron app.

- slots are `slot1-slot4`
- text is sent as plain text
- Enter can be omitted when needed
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
- `--json`: optional. Prints the accepted response as JSON
- `--client`: optional. Adds a client label for logs

## Using it through a skill

This repo is designed so a skill can simply call the `slot:send` CLI.  
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

### If another AI CLI supports skills

Use the same pattern:

- choose exactly one slot
- keep the text unchanged
- add `--no-enter` only when needed
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
