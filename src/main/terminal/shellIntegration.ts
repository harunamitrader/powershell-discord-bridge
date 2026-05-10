import { app } from 'electron';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const SCRIPT_NAME = 'powershell-discord-bridge-shell-integration.ps1';

const SCRIPT_CONTENT = [
  '$script:PowerShellDiscordBridgeOriginalPrompt = $function:prompt',
  'function global:prompt {',
  '  $esc = [char]27',
  '  $bell = [char]7',
  '  try {',
  '    $cwdBytes = [System.Text.Encoding]::UTF8.GetBytes((Get-Location).Path)',
  '    $cwdBase64 = [Convert]::ToBase64String($cwdBytes)',
  '    [Console]::Out.Write("$esc]633;P;Cwd=$cwdBase64$bell")',
  '    [Console]::Out.Write("$esc]633;A$bell")',
  '  } catch {',
  '  }',
  '',
  '  if ($script:PowerShellDiscordBridgeOriginalPrompt) {',
  '    & $script:PowerShellDiscordBridgeOriginalPrompt',
  '  } else {',
  '    "PS $($executionContext.SessionState.Path.CurrentLocation)> "',
  '  }',
  '}'
].join('\n');

export function ensurePowerShellIntegrationScript(): string {
  const directory = path.join(app.getPath('userData'), 'terminal-assets');
  const scriptPath = path.join(directory, SCRIPT_NAME);

  if (!existsSync(directory)) {
    mkdirSync(directory, { recursive: true });
  }

  if (!existsSync(scriptPath) || readFileSync(scriptPath, 'utf8') !== SCRIPT_CONTENT) {
    writeFileSync(scriptPath, SCRIPT_CONTENT, 'utf8');
  }

  return scriptPath;
}
