---
name: powershell-discord-bridge-slot-send
description: Send plain text to slot1-slot4 of the running PowerShell Discord Bridge Electron app by calling the local slot-send CLI.
---

# PowerShell Discord Bridge Slot Send

Use this skill when the user wants plain text sent into **slot1-slot4** of the running `powershell-discord-bridge` app.

## Scope

- choose one slot
- send plain text
- optionally omit Enter
- do not infer anything about which AI or tool is running inside the slot

## Repository

`C:\Users\sgmxk\Desktop\AI\repos\github\harunamitrader\powershell-discord-bridge`

## Primary command

```powershell
npm run slot:send -- --slot slot3 --text "Review this diff"
```

Equivalent direct form:

```powershell
node .\scripts\bridge-send-slot.cjs --slot slot3 --text "Review this diff"
```

## Multi-line text

```powershell
@'
line 1
line 2
'@ | node .\scripts\bridge-send-slot.cjs --slot slot3
```

## No-Enter send

```powershell
node .\scripts\bridge-send-slot.cjs --slot slot3 --text "draft only" --no-enter
```

## Rules

1. Always send to exactly one slot per command.
2. Keep the user's text unchanged unless explicitly asked to transform it.
3. If the CLI says the Electron app is not running, report that plainly.
4. This skill sends text only. It does not inspect the target slot unless separately asked.
