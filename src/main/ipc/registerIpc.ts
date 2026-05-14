import { app, BrowserWindow, ipcMain } from 'electron';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type {
  BridgeSettings,
  BridgeSettingsUpdate,
  BootstrapState,
  TerminalAutomationTurnRequest,
  TerminalControlRequest,
  TerminalInputLockUpdate,
  TerminalRedrawJiggleRequest,
  TerminalResizeRequest,
  TerminalSendInputRequest,
  TerminalSessionDataEvent,
  TerminalSessionExitEvent,
  TerminalSessionRenameRequest,
  TerminalScreenshotExportData,
  TerminalSessionSummary,
  TerminalSnapshotRequest,
  TerminalViewSnapshot,
  TerminalViewSnapshotPublishRequest,
  TerminalViewSnapshotSession,
  TerminalWaitForCompletionRequest,
  TerminalWriteRequest,
  TerminalSlotId,
  TerminalSlotSettingsUpdate,
  TerminalSlotSettingsUpdateResult
} from '../../shared/terminal';
import { TerminalAutomationService } from '../bridge/terminalAutomationService';
import { DiscordBridgeService } from '../bridge/discordBridgeService';
import { PreferencesStore } from '../app/preferencesStore';
import { TerminalSessionManager } from '../terminal/terminalSessionManager';
import { TerminalSlotService } from '../app/terminalSlotService';
import { AppLogStore } from '../app/appLogStore';

interface RegisterIpcOptions {
  discordBridgeService: DiscordBridgeService;
  terminalAutomationService: TerminalAutomationService;
  window: BrowserWindow;
  preferencesStore: PreferencesStore;
  terminalSessionManager: TerminalSessionManager;
  terminalSlotService: TerminalSlotService;
  appLogStore: AppLogStore;
}

export function registerIpc(options: RegisterIpcOptions): void {
  const { window, preferencesStore, terminalAutomationService, terminalSessionManager, discordBridgeService, terminalSlotService, appLogStore } = options;

  const sendToRenderer = (channel: string, payload: unknown): void => {
    if (window.isDestroyed()) {
      return;
    }

    const { webContents } = window;
    if (webContents.isDestroyed()) {
      return;
    }

    webContents.send(channel, payload);
  };

  const handleSessionUpdated = (session: TerminalSessionSummary) => {
    sendToRenderer('terminal:session-updated', session);
  };
  const handleSessionData = (event: TerminalSessionDataEvent) => {
    sendToRenderer('terminal:session-data', event);
  };
  const handleSessionExit = (event: TerminalSessionExitEvent) => {
    sendToRenderer('terminal:session-exit', event);
  };
  const handleSessionActivated = (event: { sessionId: string; source: 'discord' }) => {
    sendToRenderer('terminal:session-activated', event);
  };
  const handleAppLogEntry = (entry: { id: number; timestamp: string; stream: 'stdout' | 'stderr'; text: string }) => {
    sendToRenderer('terminal:app-log-entry', entry);
  };

  terminalSessionManager.on('session-updated', handleSessionUpdated);
  terminalSessionManager.on('session-data', handleSessionData);
  terminalSessionManager.on('session-exit', handleSessionExit);
  const unsubscribeSessionActivated = discordBridgeService.onSessionActivated(handleSessionActivated);
  const unsubscribeAppLogEntry = appLogStore.onEntry(handleAppLogEntry);

  window.once('closed', () => {
    terminalSessionManager.off('session-updated', handleSessionUpdated);
    terminalSessionManager.off('session-data', handleSessionData);
    terminalSessionManager.off('session-exit', handleSessionExit);
    unsubscribeSessionActivated();
    unsubscribeAppLogEntry();
  });

  ipcMain.handle('terminal:bootstrap', async (): Promise<BootstrapState> => ({
    defaultCwd: terminalSessionManager.getDefaultCwd(),
    shellLabel: terminalSessionManager.getShellLabel(),
    bridgeDimensions: terminalSessionManager.getBridgeDimensions(),
    bridgeSettings: preferencesStore.getBridgeSettings(),
    terminalSlots: terminalSlotService.listSlots(),
    sessions: terminalSessionManager.listSessions(),
    appLogs: appLogStore.listEntries()
  }));

  ipcMain.handle('terminal:restart-slot', async (_event, slotId: TerminalSlotId) => {
    return discordBridgeService.restartSlot(slotId);
  });

  ipcMain.handle('terminal:update-slot', async (_event, update: TerminalSlotSettingsUpdate): Promise<TerminalSlotSettingsUpdateResult> => {
    return discordBridgeService.updateTerminalSlot(update);
  });

  ipcMain.handle('terminal:write', async (_event, request: TerminalWriteRequest) => {
    terminalSessionManager.write(request);
  });

  ipcMain.handle('terminal:resize', async (_event, request: TerminalResizeRequest) => {
    terminalSessionManager.resize(request);
  });

  ipcMain.handle('terminal:rename-session', async (_event, request: TerminalSessionRenameRequest) => {
    return discordBridgeService.renameSession(request);
  });

  ipcMain.handle('terminal:get-session-state', async (_event, sessionId: string) => {
    return terminalSessionManager.getSessionState(sessionId);
  });

  ipcMain.handle('terminal:get-buffer-snapshot', async (_event, request: TerminalSnapshotRequest) => {
    return terminalSessionManager.getBufferSnapshot(request.sessionId, request.reason);
  });

  ipcMain.handle('terminal:send-input', async (_event, request: TerminalSendInputRequest) => {
    await terminalAutomationService.sendInput(request);
  });

  ipcMain.handle('terminal:wait-for-completion', async (_event, request: TerminalWaitForCompletionRequest) => {
    return terminalAutomationService.waitForCompletion(request);
  });

  ipcMain.handle('terminal:run-automation-turn', async (_event, request: TerminalAutomationTurnRequest) => {
    return terminalAutomationService.runAutomationTurn(request);
  });

  ipcMain.handle('terminal:redraw-jiggle', async (_event, request: TerminalRedrawJiggleRequest) => {
    await terminalSessionManager.redrawJiggle(request);
  });

  ipcMain.handle('terminal:send-key', async (_event, request: TerminalControlRequest) => {
    terminalSessionManager.sendKey(request.sessionId, request.key, request.source);
  });

  ipcMain.handle('terminal:stop-request', async (_event, sessionId: string) => {
    terminalAutomationService.requestAbort(sessionId);
  });

  ipcMain.handle('terminal:set-input-lock', async (_event, update: TerminalInputLockUpdate) => {
    return terminalSessionManager.setInputLock(update);
  });

  ipcMain.handle('terminal:update-bridge-settings', async (_event, update: BridgeSettingsUpdate): Promise<BridgeSettings> => {
    const settings = preferencesStore.setBridgeSettings(update);
    terminalSessionManager.applyBridgeSettings();
    return settings;
  });

  ipcMain.handle('terminal:publish-live-view-snapshot', async (_event, request: TerminalViewSnapshotPublishRequest) => {
    const sessions = terminalSessionManager.listSessions();
    const snapshot: TerminalViewSnapshot = {
      timestamp: new Date().toISOString(),
      activeSessionId: request.activeSessionId ?? null,
      sessions: sessions.map((session): TerminalViewSnapshotSession => ({
        id: session.id,
        title: session.title,
        shellLabel: session.shellLabel,
        status: session.status,
        mode: session.mode,
        resizeMode: session.resizeMode,
        inputLocked: session.inputLocked,
        cwd: session.cwd,
        exitCode: session.exitCode,
        isActive: session.id === request.activeSessionId
      })),
      terminal: null,
      sessionTerminals: []
    };

    const sessionTerminals = await Promise.all(
      sessions
        .filter((session) => terminalSessionManager.hasSession(session.id))
        .map(async (session) => {
          const [state, bufferSnapshot] = await Promise.all([
            terminalSessionManager.getSessionState(session.id),
            terminalSessionManager.getBufferSnapshot(session.id, 'manual')
          ]);

          return {
            sessionId: session.id,
            status: state.status,
            mode: state.mode,
            resizeMode: state.resizeMode,
            inputLocked: state.inputLocked,
            screenText: bufferSnapshot.screenText,
            screenRevision: bufferSnapshot.screenRevision,
            lineCount: bufferSnapshot.lineCount,
            hash: bufferSnapshot.hash,
            rawTranscriptLength: state.rawTranscriptLength,
            observedOutputEvents: state.observedOutputEvents,
            lastActivityAt: state.lastActivityAt,
            lastPromptReadyAt: state.lastPromptReadyAt
          };
        })
    );
    snapshot.sessionTerminals = sessionTerminals;

    if (request.activeSessionId) {
      snapshot.terminal = sessionTerminals.find((terminal) => terminal.sessionId === request.activeSessionId) ?? null;
    }

    const outputPath = path.join(app.getPath('userData'), 'debug', 'live-view-snapshot.json');
    mkdirSync(path.dirname(outputPath), { recursive: true });
    writeFileSync(outputPath, JSON.stringify(snapshot, null, 2), 'utf8');
  });

  ipcMain.handle('terminal:get-screenshot-export', async (_event, sessionId: string): Promise<TerminalScreenshotExportData> => {
    const session = terminalSessionManager.listSessions().find((entry) => entry.id === sessionId);
    if (!session) {
      throw new Error(`Unknown terminal session: ${sessionId}`);
    }

    const [state, transcript] = await Promise.all([
      terminalSessionManager.getSessionState(sessionId),
      terminalSessionManager.getRawTranscriptSince(sessionId, 0)
    ]);

    return {
      sessionId,
      title: session.title,
      cwd: session.cwd,
      cols: state.cols,
      rows: state.rows,
      transcript
    };
  });
}
