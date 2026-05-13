import { config as loadEnvFile } from 'dotenv';
import { app, BrowserWindow } from 'electron';
import { APP_USER_MODEL_ID } from './app/appIdentity';
import { AppLogStore } from './app/appLogStore';
import { createMainWindow } from './app/createMainWindow';
import { loadBridgeRuntimeConfig } from './bridge/bridgeConfig';
import { ChannelSessionRegistry } from './bridge/channelSessionRegistry';
import { DiscordBridgeService } from './bridge/discordBridgeService';
import { TerminalAutomationService } from './bridge/terminalAutomationService';
import { PreferencesStore } from './app/preferencesStore';
import { TerminalSlotService } from './app/terminalSlotService';
import { registerIpc } from './ipc/registerIpc';
import { TerminalSessionManager } from './terminal/terminalSessionManager';

const appLogStore = new AppLogStore();
appLogStore.installProcessCapture();

loadEnvFile();
app.setAppUserModelId(APP_USER_MODEL_ID);

let mainWindow: BrowserWindow | undefined;
let terminalSessionManager: TerminalSessionManager | undefined;
let discordBridgeService: DiscordBridgeService | undefined;
const hasSingleInstanceLock = app.requestSingleInstanceLock();

async function bootstrap(): Promise<void> {
  const preferencesStore = new PreferencesStore();
  terminalSessionManager = new TerminalSessionManager(preferencesStore, appLogStore);
  const terminalSlotService = new TerminalSlotService(preferencesStore, terminalSessionManager);
  const bridgeRuntimeConfig = loadBridgeRuntimeConfig();
  if (bridgeRuntimeConfig.allowUserIds.length === 0) {
    console.warn('ALLOW_USER_IDS is empty. Discord commands are blocked until at least one allowed user ID is configured.');
  }
  const channelSessionRegistry = new ChannelSessionRegistry(terminalSessionManager);
  const terminalAutomationService = new TerminalAutomationService(terminalSessionManager, bridgeRuntimeConfig, preferencesStore);
  const window = createMainWindow(preferencesStore);
  mainWindow = window;
  discordBridgeService = new DiscordBridgeService(
    channelSessionRegistry,
    terminalAutomationService,
    terminalSessionManager,
    terminalSlotService,
    bridgeRuntimeConfig,
    () => mainWindow,
    preferencesStore
  );

  terminalSessionManager.on('session-exit', ({ sessionId }) => {
    terminalSlotService.handleSessionExit(sessionId);
    channelSessionRegistry.markSessionExited(sessionId);
  });

  registerIpc({
    discordBridgeService,
    window,
    preferencesStore,
    terminalAutomationService,
    terminalSessionManager,
    terminalSlotService,
    appLogStore
  });

  window.once('closed', () => {
    if (mainWindow === window) {
      mainWindow = undefined;
    }
  });

  terminalSlotService.ensureSessions();

  try {
    await discordBridgeService.start();
    await discordBridgeService.ensureStartupBindings();
  } catch (error) {
    console.error('Failed to start Discord bridge service', error);
  }
}

function focusMainWindow(): void {
  if (!mainWindow) {
    return;
  }

  if (mainWindow.isMinimized()) {
    mainWindow.restore();
  }

  mainWindow.focus();
}

if (!hasSingleInstanceLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    focusMainWindow();
  });

  void app.whenReady().then(async () => {
    await bootstrap();

    app.on('activate', async () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        await bootstrap();
        return;
      }

      focusMainWindow();
    });
  });
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', () => {
  discordBridgeService?.stop();
  terminalSessionManager?.disposeAll();
});
