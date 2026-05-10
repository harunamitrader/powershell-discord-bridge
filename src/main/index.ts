import { app, BrowserWindow } from 'electron';
import { createMainWindow } from './app/createMainWindow';
import { loadBridgeRuntimeConfig } from './bridge/bridgeConfig';
import { ChannelSessionRegistry } from './bridge/channelSessionRegistry';
import { DiscordBridgeService } from './bridge/discordBridgeService';
import { TerminalAutomationService } from './bridge/terminalAutomationService';
import { PreferencesStore } from './app/preferencesStore';
import { registerIpc } from './ipc/registerIpc';
import { TerminalSessionManager } from './terminal/terminalSessionManager';

let mainWindow: BrowserWindow | undefined;
let terminalSessionManager: TerminalSessionManager | undefined;
let discordBridgeService: DiscordBridgeService | undefined;

async function bootstrap(): Promise<void> {
  const preferencesStore = new PreferencesStore();
  terminalSessionManager = new TerminalSessionManager(preferencesStore);
  const bridgeRuntimeConfig = loadBridgeRuntimeConfig();
  const channelSessionRegistry = new ChannelSessionRegistry(terminalSessionManager, bridgeRuntimeConfig);
  const terminalAutomationService = new TerminalAutomationService(terminalSessionManager, bridgeRuntimeConfig);
  mainWindow = createMainWindow(preferencesStore);
  discordBridgeService = new DiscordBridgeService(
    channelSessionRegistry,
    terminalAutomationService,
    bridgeRuntimeConfig,
    () => mainWindow
  );

  terminalSessionManager.on('session-exit', ({ sessionId }) => {
    channelSessionRegistry.markSessionExited(sessionId);
  });

  registerIpc({
    window: mainWindow,
    preferencesStore,
    terminalAutomationService,
    terminalSessionManager
  });

  void discordBridgeService.start().catch((error) => {
    console.error('Failed to start Discord bridge service', error);
  });
}

void app.whenReady().then(async () => {
  await bootstrap();

  app.on('activate', async () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      await bootstrap();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', () => {
  discordBridgeService?.stop();
  terminalSessionManager?.disposeAll();
});
