import { app } from 'electron';
import { existsSync, renameSync } from 'node:fs';
import path from 'node:path';

const USER_DATA_DIRNAME = 'multicli-discord-bridge';
const LEGACY_USER_DATA_DIRNAMES = ['PowerShell Discord Bridge', 'powershell-discord-bridge'];
const BRIDGE_STORAGE_DIRNAME = 'multicli-discord-bridge';
const LEGACY_BRIDGE_STORAGE_DIRNAME = 'discord-bridge';

export function prepareAppPathMigration(): void {
  const appDataPath = app.getPath('appData');
  const userDataPath = path.join(appDataPath, USER_DATA_DIRNAME);

  if (!existsSync(userDataPath)) {
    for (const legacyDirname of LEGACY_USER_DATA_DIRNAMES) {
      const legacyUserDataPath = path.join(appDataPath, legacyDirname);
      if (!existsSync(legacyUserDataPath)) {
        continue;
      }

      try {
        renameSync(legacyUserDataPath, userDataPath);
      } catch (error) {
        console.warn(`Failed to migrate legacy userData directory: ${legacyUserDataPath}`, error);
      }
      break;
    }
  }

  app.setPath('userData', userDataPath);

  const legacyBridgeStoragePath = path.join(userDataPath, LEGACY_BRIDGE_STORAGE_DIRNAME);
  const bridgeStoragePath = path.join(userDataPath, BRIDGE_STORAGE_DIRNAME);
  if (!existsSync(bridgeStoragePath) && existsSync(legacyBridgeStoragePath)) {
    try {
      renameSync(legacyBridgeStoragePath, bridgeStoragePath);
    } catch (error) {
      console.warn(`Failed to migrate bridge storage directory: ${legacyBridgeStoragePath}`, error);
    }
  }
}

export function resolveBridgeStoragePath(...segments: string[]): string {
  return path.join(app.getPath('userData'), BRIDGE_STORAGE_DIRNAME, ...segments);
}
