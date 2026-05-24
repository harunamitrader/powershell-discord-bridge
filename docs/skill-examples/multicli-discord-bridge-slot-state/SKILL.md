---
name: multicli-discord-bridge-slot-state
description: Read coordination state for slot1-slot6 of the running multicli-discord-bridge Electron app by calling the local slot-observe CLI.
---

# multicli-discord-bridge slot state

Use this skill when the user wants to inspect the current shared coordination state of the running `multicli-discord-bridge` app without sending text.

## Scope

- read slot coordination state
- optionally filter to one slot
- summarize `cwd`, `status`, `updatedAt`, `foregroundCommand`, and `recentInbound`
- do not send text
- do not infer hidden runtime semantics beyond the recorded state

## Repository

`C:\Users\sgmxk\Desktop\AI\repos\github\harunamitrader\multicli-discord-bridge`

## Primary commands

Read all slots:

```powershell
npm run slot:observe -- --state
```

Read one slot:

```powershell
npm run slot:observe -- --slot slot3 --state
```

Equivalent direct form:

```powershell
node .\scripts\bridge-observe.cjs --state
node .\scripts\bridge-observe.cjs --slot slot3 --state
```

## What the JSON contains

- `cwd`
- `status`
- `updatedAt`
- `foregroundCommand`
- `recentInbound`

`foregroundCommand` means only the **first Enter-submitted command after the last `promptReady`**. It is not a semantic runtime classifier.

## When to use this skill

- before inter-slot handoff
- before choosing which slot should receive a request
- when the user asks what each slot is doing
- when the user asks for recent inbound context across slots

## When not to use this skill

- when the user only wants text sent to a known slot
- when the user explicitly wants raw visible terminal text instead of shared state
- when the user explicitly wants screenshots

## Optional follow-up inspection

If slot-state is not enough and the user needs raw terminal text, use:

```powershell
npm run slot:observe -- --slot slot3 --text
```

If the user explicitly asks for screenshots, use:

```powershell
npm run slot:observe -- --slot slot3 --screenshot
npm run slot:observe -- --window-screenshot
```

## Rules

1. Do not send any text while using this skill.
2. Prefer `--state` first over per-slot text reads when the task is coordination-oriented.
3. If one target slot is enough, prefer `--slot slotN --state` over reading all slots.
4. Treat `foregroundCommand` as recorded state only; do not reinterpret it as a guaranteed runtime identity.
5. If raw screen content is required, explicitly switch to `slot:observe -- --slot ... --text`.
