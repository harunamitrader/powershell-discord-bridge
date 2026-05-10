# Contributing

## Development workflow

1. Create a feature branch
2. Make focused changes
3. Run:

```powershell
npm run typecheck
npm run build
```

4. Open a pull request with a clear summary

## Scope guidelines

- keep the app PowerShell-first unless shell expansion is an intentional project goal
- preserve the Discord bridge safety model based on allowlists
- avoid changes that silently weaken session isolation or input locking

## Before opening a PR

- update docs when behavior changes
- avoid committing `.env` or other machine-local secrets
- keep Windows paths in Windows format
