import { existsSync, unlinkSync } from 'node:fs';

const STARTUP_SPLASH_SIGNAL_ENV = 'PS_DISCORD_BRIDGE_SPLASH_SIGNAL';

export function dismissStartupSplash(): void {
  const signalPath = process.env[STARTUP_SPLASH_SIGNAL_ENV];
  if (!signalPath) {
    return;
  }

  delete process.env[STARTUP_SPLASH_SIGNAL_ENV];

  if (!existsSync(signalPath)) {
    return;
  }

  try {
    unlinkSync(signalPath);
  } catch (error) {
    console.warn(`Failed to remove startup splash signal: ${signalPath}`, error);
  }
}
