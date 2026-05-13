import { clipboard, contextBridge, ipcRenderer } from 'electron';
import type {
  BridgeSettings,
  BridgeSettingsUpdate,
  BootstrapState,
  TerminalAutomationTurnRequest,
  TerminalAutomationTurnResult,
  TerminalApi,
  TerminalControlRequest,
  TerminalInputLockUpdate,
  TerminalRedrawJiggleRequest,
  TerminalSendInputRequest,
  TerminalSessionDataEvent,
  TerminalSessionExitEvent,
  TerminalSessionRenameRequest,
  TerminalScreenshotExportData,
  TerminalSessionSnapshot,
  TerminalSessionState,
  TerminalSessionSummary,
  TerminalSlotId,
  TerminalSlotSettingsUpdate,
  TerminalSlotSettingsUpdateResult,
  TerminalSnapshotRequest,
  TerminalViewSnapshotPublishRequest,
  TerminalWaitForCompletionRequest,
  TerminalWaitForCompletionResult,
  TerminalWriteRequest
} from '../shared/terminal';

function subscribe<T>(channel: string, listener: (payload: T) => void): () => void {
  const handler = (_event: Electron.IpcRendererEvent, payload: T) => {
    listener(payload);
  };

  ipcRenderer.on(channel, handler);
  return () => {
    ipcRenderer.removeListener(channel, handler);
  };
}

const api: TerminalApi = {
  async bootstrap(): Promise<BootstrapState> {
    return ipcRenderer.invoke('terminal:bootstrap');
  },
  async restartTerminalSlot(slotId: TerminalSlotId): Promise<TerminalSessionSummary> {
    return ipcRenderer.invoke('terminal:restart-slot', slotId);
  },
  async updateTerminalSlot(update: TerminalSlotSettingsUpdate): Promise<TerminalSlotSettingsUpdateResult> {
    return ipcRenderer.invoke('terminal:update-slot', update);
  },
  async writeClipboard(text: string): Promise<void> {
    clipboard.writeText(text);
  },
  async write(sessionId: string, data: string): Promise<void> {
    const request: TerminalWriteRequest = {
      sessionId,
      data,
      source: 'local'
    };
    await ipcRenderer.invoke('terminal:write', request);
  },
  async resize(sessionId: string, cols: number, rows: number): Promise<void> {
    await ipcRenderer.invoke('terminal:resize', {
      sessionId,
      cols,
      rows,
      source: 'local'
    });
  },
  async renameSession(request: TerminalSessionRenameRequest): Promise<TerminalSessionSummary> {
    return ipcRenderer.invoke('terminal:rename-session', request);
  },
  async getSessionState(sessionId: string): Promise<TerminalSessionState> {
    return ipcRenderer.invoke('terminal:get-session-state', sessionId);
  },
  async getBufferSnapshot(request: TerminalSnapshotRequest): Promise<TerminalSessionSnapshot> {
    return ipcRenderer.invoke('terminal:get-buffer-snapshot', request);
  },
  async sendInput(request: TerminalSendInputRequest): Promise<void> {
    await ipcRenderer.invoke('terminal:send-input', request);
  },
  async waitForCompletion(request: TerminalWaitForCompletionRequest): Promise<TerminalWaitForCompletionResult> {
    return ipcRenderer.invoke('terminal:wait-for-completion', request);
  },
  async runAutomationTurn(request: TerminalAutomationTurnRequest): Promise<TerminalAutomationTurnResult> {
    return ipcRenderer.invoke('terminal:run-automation-turn', request);
  },
  async redrawJiggle(request: TerminalRedrawJiggleRequest): Promise<void> {
    await ipcRenderer.invoke('terminal:redraw-jiggle', request);
  },
  async sendKey(request: TerminalControlRequest): Promise<void> {
    await ipcRenderer.invoke('terminal:send-key', request);
  },
  async stopRequest(sessionId: string): Promise<void> {
    await ipcRenderer.invoke('terminal:stop-request', sessionId);
  },
  async setInputLock(update: TerminalInputLockUpdate): Promise<TerminalSessionSummary> {
    return ipcRenderer.invoke('terminal:set-input-lock', update);
  },
  onSessionUpdated(listener: (session: TerminalSessionSummary) => void): () => void {
    return subscribe('terminal:session-updated', listener);
  },
  onSessionData(listener: (event: TerminalSessionDataEvent) => void): () => void {
    return subscribe('terminal:session-data', listener);
  },
  onSessionExit(listener: (event: TerminalSessionExitEvent) => void): () => void {
    return subscribe('terminal:session-exit', listener);
  },
  async updateBridgeSettings(update: BridgeSettingsUpdate): Promise<BridgeSettings> {
    return ipcRenderer.invoke('terminal:update-bridge-settings', update);
  },
  async publishLiveViewSnapshot(request: TerminalViewSnapshotPublishRequest): Promise<void> {
    await ipcRenderer.invoke('terminal:publish-live-view-snapshot', request);
  },
  async getTerminalScreenshotExport(sessionId: string): Promise<TerminalScreenshotExportData> {
    return ipcRenderer.invoke('terminal:get-screenshot-export', sessionId);
  }
};

contextBridge.exposeInMainWorld('terminalApp', api);
