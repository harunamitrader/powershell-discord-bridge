#!/usr/bin/env node

const { spawn } = require('node:child_process');
const { existsSync } = require('node:fs');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..');
const cronTuiRoot = path.join(repoRoot, 'bridge-cron-tui');
const cronTuiEntry = path.join(cronTuiRoot, 'src', 'index.js');
const cronTuiDependency = path.join(cronTuiRoot, 'node_modules', 'ink');

if (!existsSync(cronTuiEntry)) {
  console.error(`mcron could not find the cron TUI entry point: ${cronTuiEntry}`);
  process.exit(1);
}

if (!existsSync(cronTuiDependency)) {
  console.error('mcron is not ready yet. Run "npm run cron:tui:install" from the multicli-discord-bridge repository first.');
  process.exit(1);
}

const child = spawn(process.execPath, [cronTuiEntry], {
  cwd: cronTuiRoot,
  stdio: 'inherit',
  env: process.env
});

child.on('error', (error) => {
  console.error(`mcron failed to start: ${error.message}`);
  process.exit(1);
});

child.on('exit', (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }

  process.exit(code ?? 0);
});
