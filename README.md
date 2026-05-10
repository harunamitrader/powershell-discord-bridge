# PowerShell Discord Bridge

PowerShell Discord Bridge is an Electron app for operating a local PowerShell terminal from Discord while keeping the terminal visible in a desktop UI.

## What it does

- runs local PowerShell sessions inside an Electron app
- binds one Discord channel to one bridge-managed terminal session
- relays terminal input from Discord to the local PowerShell process
- returns terminal output back to Discord
- captures app-window screenshots on demand with `[[terminal:screenshot]]`
- keeps a local desktop session and a Discord bridge session side by side

## Current scope

- Windows host
- PowerShell-only terminal backend
- Discord bot driven bridge workflow
- Electron desktop UI for local inspection and control

This project does **not** currently support non-PowerShell shells such as cmd, bash, zsh, or WSL.

## Main commands

- normal Discord messages: sent to the active bridge-managed PowerShell session
- `[[terminal:enter]]`
- `[[terminal:ctrl-c]]`
- `[[terminal:esc]]`
- `[[terminal:stop]]`
- `[[terminal:screenshot]]` - replies with an app-window screenshot attachment

## Local development

1. Copy `.env.example` to `.env`
2. Fill in the Discord bot and allowlist values
3. Install dependencies
4. Start the app

```powershell
npm install
npm run dev
```

For a production-style local run:

```powershell
npm run build
npm start
```

Or use the helper launcher:

```powershell
.\launch-powershell-discord-bridge.cmd
```

## Repository layout

- `src/main` - Electron main process, Discord bridge logic, terminal session management
- `src/renderer` - desktop UI
- `src/preload` - preload bridge APIs
- `src/shared` - shared contracts
- `docs` - design notes and bridge specifications

## Security notes

- keep `.env` out of version control
- restrict access with `DISCORD_ALLOWED_USER_ID` and `DISCORD_ALLOWED_CHANNEL_IDS`
- treat this as a local-control tool with real access to your machine

## Publishing notes

Before publishing publicly, review:

- the final repository name on GitHub
- the chosen open-source license
- the example environment file
- any remaining local-only paths or secrets

## License

MIT
