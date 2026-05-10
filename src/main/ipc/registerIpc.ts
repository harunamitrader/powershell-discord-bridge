import { app, BrowserWindow, ipcMain } from 'electron';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type {
  BootstrapState,
  CreateSessionOptions,
  SidebarWidthUpdate,
  TerminalAutomationTurnRequest,
  TerminalControlRequest,
  TerminalInputLockUpdate,
  TerminalRedrawJiggleRequest,
  TerminalResizeRequest,
  TerminalSendInputRequest,
  TerminalSessionRenameRequest,
  TerminalSnapshotRequest,
  TerminalViewSnapshot,
  TerminalViewSnapshotPublishRequest,
  TerminalViewSnapshotSession,
  TerminalWaitForCompletionRequest,
  TerminalWriteRequest
} from '../../shared/terminal';
import { TerminalAutomationService } from '../bridge/terminalAutomationService';
import { PreferencesStore } from '../app/preferencesStore';
import { TerminalSessionManager } from '../terminal/terminalSessionManager';

interface RegisterIpcOptions {
  terminalAutomationService: TerminalAutomationService;
  window: BrowserWindow;
  preferencesStore: PreferencesStore;
  terminalSessionManager: TerminalSessionManager;
}

export function registerIpc(options: RegisterIpcOptions): void {
  const { window, preferencesStore, terminalAutomationService, terminalSessionManager } = options;

  terminalSessionManager.on('session-updated', (session) => {
    window.webContents.send('terminal:session-updated', session);
  });

  terminalSessionManager.on('session-data', (event) => {
    window.webContents.send('terminal:session-data', event);
  });

  terminalSessionManager.on('session-exit', (event) => {
    window.webContents.send('terminal:session-exit', event);
  });

  ipcMain.handle('terminal:bootstrap', async (): Promise<BootstrapState> => ({
    defaultCwd: terminalSessionManager.getDefaultCwd(),
    shellLabel: terminalSessionManager.getShellLabel(),
    sidebarWidth: preferencesStore.getDefaultSidebarWidth(),
    bridgeDimensions: terminalSessionManager.getBridgeDimensions()
  }));

  ipcMain.handle('terminal:create-session', async (_event, request?: CreateSessionOptions) => {
    return terminalSessionManager.createSession(request);
  });

  ipcMain.handle('terminal:write', async (_event, request: TerminalWriteRequest) => {
    terminalSessionManager.write(request);
  });

  ipcMain.handle('terminal:resize', async (_event, request: TerminalResizeRequest) => {
    terminalSessionManager.resize(request);
  });

  ipcMain.handle('terminal:close-session', async (_event, sessionId: string) => {
    terminalSessionManager.closeSession(sessionId);
  });

  ipcMain.handle('terminal:rename-session', async (_event, request: TerminalSessionRenameRequest) => {
    return terminalSessionManager.renameSession(request.sessionId, request.title);
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

  ipcMain.handle('terminal:set-sidebar-width', async (_event, update: SidebarWidthUpdate) => {
    preferencesStore.setSidebarWidth(update.width);
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
}
