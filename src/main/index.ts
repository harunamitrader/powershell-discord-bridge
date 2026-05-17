import { config as loadEnvFile } from 'dotenv';
import { app, BrowserWindow } from 'electron';
import { APP_USER_MODEL_ID } from './app/appIdentity';
import { AppLogStore } from './app/appLogStore';
import { createMainWindow } from './app/createMainWindow';
import { loadBridgeRuntimeConfig } from './bridge/bridgeConfig';
import { ChannelSessionRegistry } from './bridge/channelSessionRegistry';
import { ArtifactPublishService } from './bridge/artifactPublishService';
import { DiscordBridgeService } from './bridge/discordBridgeService';
import { TerminalAutomationService } from './bridge/terminalAutomationService';
import { PreferencesStore } from './app/preferencesStore';
import { dismissStartupSplash } from './app/startupSplashSignal';
import { TerminalSlotService } from './app/terminalSlotService';
import { LocalAutomationServer } from './automation/localAutomationServer';
import { registerIpc } from './ipc/registerIpc';
import { TerminalSessionManager } from './terminal/terminalSessionManager';

const appLogStore = new AppLogStore();
appLogStore.installProcessCapture();

loadEnvFile();
app.setAppUserModelId(APP_USER_MODEL_ID);

let mainWindow: BrowserWindow | undefined;
let terminalSessionManager: TerminalSessionManager | undefined;
let discordBridgeService: DiscordBridgeService | undefined;
let artifactPublishService: ArtifactPublishService | undefined;
let localAutomationServer: LocalAutomationServer | undefined;
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
  artifactPublishService = new ArtifactPublishService(preferencesStore, terminalSlotService, discordBridgeService);
  localAutomationServer = new LocalAutomationServer(
    terminalSlotService,
    terminalAutomationService,
    terminalSessionManager,
    preferencesStore,
    () => mainWindow,
    appLogStore
  );
  artifactPublishService.initializeDefaults();

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
      appLogStore,
      artifactPublishService
    });

  window.once('closed', () => {
    if (mainWindow === window) {
      mainWindow = undefined;
    }
  });

  terminalSlotService.ensureSessions();
  localAutomationServer.start();

  try {
    await discordBridgeService.start();
    await discordBridgeService.ensureStartupBindings();
    artifactPublishService.start();
  } catch (error) {
    console.error('Failed to start Discord bridge service', error);
  }
}

function handleStartupFailure(message: string, error: unknown): void {
  console.error(message, error);
  dismissStartupSplash();
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
  dismissStartupSplash();
  app.quit();
} else {
  app.on('second-instance', () => {
    focusMainWindow();
  });

  void app.whenReady()
    .then(async () => {
      await bootstrap();

      app.on('activate', async () => {
        if (BrowserWindow.getAllWindows().length === 0) {
          try {
            await bootstrap();
          } catch (error) {
            handleStartupFailure('Failed to re-open main window', error);
          }
          return;
        }

        focusMainWindow();
      });
    })
    .catch((error: unknown) => {
      handleStartupFailure('App startup failed', error);
      app.quit();
    });
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', () => {
  localAutomationServer?.stop();
  artifactPublishService?.stop();
  discordBridgeService?.stop();
  terminalSessionManager?.disposeAll();
});
