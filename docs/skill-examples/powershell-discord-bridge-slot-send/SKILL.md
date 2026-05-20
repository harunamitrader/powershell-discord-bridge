---
name: powershell-discord-bridge-slot-send
description: Send plain text to slot1-slot6 of the running PowerShell Discord Bridge Electron app by calling the local slot-send CLI.
---

# PowerShell Discord Bridge Slot Send

Use this skill when the user wants plain text sent into **slot1-slot6** of the running `powershell-discord-bridge` app.

## Scope

- choose one slot
- send plain text
- optionally omit Enter
- do not infer anything about which AI or tool is running inside the slot

## Repository

`C:\Users\sgmxk\Desktop\AI\repos\github\harunamitrader\powershell-discord-bridge`

## Primary command

```powershell
npm run slot:send -- --slot slot3 --from slot2 --text "This is Copilot in slot2. Review this diff."
```

Equivalent direct form:

```powershell
node .\scripts\bridge-send-slot.cjs --slot slot3 --from slot2 --text "This is Copilot in slot2. Review this diff."
```

## Multi-line text

```powershell
@'
line 1
line 2
'@ | node .\scripts\bridge-send-slot.cjs --slot slot3 --from slot2
```

## No-Enter send

```powershell
node .\scripts\bridge-send-slot.cjs --slot slot3 --from human --text "draft only" --no-enter
```

## Optional completion callback

Completion callbacks are **OFF by default**, including when this skill is used by an AI.

Only add `--notify-on-complete --origin-slot slotN` when:
- the AI explicitly needs a callback in another slot before deciding the next step, or
- the user explicitly asks to be notified back in the sender slot

Example:

```powershell
node .\scripts\bridge-send-slot.cjs --slot slot3 --from slot2 --text "This is Copilot in slot2. Notify slot2 when done." --notify-on-complete --origin-slot slot2
```

## Optional inspection commands

If the user explicitly asks what is visible in a slot, use:

```powershell
npm run slot:observe -- --slot slot3 --text
```

If the user explicitly asks for a slot screenshot, use:

```powershell
npm run slot:observe -- --slot slot3 --screenshot
```

If the user explicitly asks for the whole app screenshot, use:

```powershell
npm run slot:observe -- --window-screenshot
```

For checking other slots, call `slot:observe -- --slot ... --text` per slot and let the AI read the returned text.

## Rules

1. Always send to exactly one slot per command.
2. Always pass `--from` with one of: `slot1-slot6`, `human`, `cron`, or `external:<label>`.
3. For AI-authored inter-slot requests, begin the body with a short self-introduction such as `This is Copilot in slot2.` when you know your own sender label.
4. If you do not know your own sender slot, ask the user first. Only if that would block the task may you inspect visible text from `slot1-slot6` to identify yourself.
5. If the CLI says the Electron app is not running, report that plainly.
6. Do not inspect screenshots unless the user explicitly asks; when inspection is needed for sender identification, prefer visible text first.
7. Do NOT enable completion callbacks by default. Use them only when clearly needed.
