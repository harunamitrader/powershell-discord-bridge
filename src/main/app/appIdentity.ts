import { app } from 'electron';
import { existsSync } from 'node:fs';
import path from 'node:path';

export const APP_USER_MODEL_ID = 'com.harunamitrader.multicli-discord-bridge';

export function resolveAppIconPath(): string | undefined {
  const roots = [app.getAppPath(), process.resourcesPath];
  const filenames = ['app-icon.ico', 'app-icon.png'];

  for (const root of roots) {
    for (const filename of filenames) {
      const candidate = path.join(root, 'assets', filename);
      if (existsSync(candidate)) {
        return candidate;
      }
    }
  }

  return undefined;
}
