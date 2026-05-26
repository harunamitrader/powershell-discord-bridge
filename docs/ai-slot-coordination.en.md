# AI slot coordination and skill templates

multicli-discord-bridge treats **AI-to-AI slot coordination as a standard feature**.  
This is mainly intended for **AI skills using the bridge internally**. End users are not expected to type `slot:send` or `slot:observe` directly in normal use.

## What it enables

While the app is running, the local-only automation endpoint supports three main actions:

1. **send text to another slot**
2. **read another slot's shared coordination state**
3. **fetch another slot's visible text**

Slot screenshots and full app screenshots are available only when needed.

## The three bundled templates

This repo bundles these Copilot skill templates:

- `docs\skill-templates\multicli-discord-bridge-slot-send\SKILL.md`
- `docs\skill-templates\multicli-discord-bridge-slot-state\SKILL.md`
- `docs\skill-templates\multicli-discord-bridge-slot-text\SKILL.md`

They are shipped as templates because users differ in:

- the absolute path of the repo clone
- the Windows username inside `C:\Users\<your-user>\.copilot\skills\...`
- which AI CLI actually runs in each slot

## How to install them for Copilot

1. Create these folders:

```text
C:\Users\<your-user>\.copilot\skills\multicli-discord-bridge-slot-send
C:\Users\<your-user>\.copilot\skills\multicli-discord-bridge-slot-state
C:\Users\<your-user>\.copilot\skills\multicli-discord-bridge-slot-text
```

2. Copy each template into the matching folder as `SKILL.md`
3. Replace `<repo-path>` in the copied files with your local repo path

## Role of each skill

### 1. slot-send

- role: send plain text into another slot
- use when: handing off work, asking for review, requesting a report
- do not use when: you only need to inspect state

### 2. slot-state

- role: read lightweight shared coordination state
- fields: `cwd`, `status`, `updatedAt`, `foregroundCommand`, `recentInbound`
- use when: you first want the overall situation

`foregroundCommand` records only the **first Enter-submitted command after the last `promptReady`**.  
It is not a semantic runtime classifier.

### 3. slot-text

- role: read visible terminal text
- use when: state alone is not enough and you need the actual screen text
- do not use when: a lightweight state check is enough

## Recommended flow

1. **state skill**
2. **text skill** only if needed
3. **send skill** for the actual handoff

This keeps the send skill focused.

## AI-facing internal commands

This section is for template and skill authors, not for normal end users.

### Send text to another slot

```powershell
npm run slot:send -- --slot slot3 --from slot2 --text "This is Copilot in slot2. Please review this diff."
```

- `--from` is required
- add `--no-enter` to omit Enter
- add `--notify-on-complete --origin-slot slotN` **only when truly needed**

### Read shared state

```powershell
npm run slot:observe -- --state
npm run slot:observe -- --slot slot3 --state
```

### Read visible text

```powershell
npm run slot:observe -- --slot slot3 --text
```

### Use screenshots only when needed

```powershell
npm run slot:observe -- --slot slot3 --screenshot
npm run slot:observe -- --window-screenshot
```

## Rules

- Treat coordination commands as **AI-facing**, not normal end-user commands
- prefer `state` first, then `text` only when needed
- keep `send` send-only
- leave completion callbacks off by default
- use screenshots only when explicitly needed
