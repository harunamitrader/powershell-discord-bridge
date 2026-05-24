import { spawn, type IPty } from '@lydell/node-pty';
import { EventEmitter } from 'node:events';
import { existsSync } from 'node:fs';
import path from 'node:path';
import type {
  CompletionReason,
  CreateSessionOptions,
  TerminalControlKey,
  TerminalDimensions,
  TerminalInputLockUpdate,
  TerminalResizeMode,
  TerminalResizeRequest,
  TerminalRedrawJiggleRequest,
  TerminalSessionSnapshot,
  TerminalSessionState,
  TerminalSessionSummary,
  TerminalSessionMode,
  TerminalSnapshotReason,
  TerminalWriteRequest,
  TerminalWriteSource
} from '../../shared/terminal';
import { AppLogStore } from '../app/appLogStore';
import { PreferencesStore } from '../app/preferencesStore';
import { TerminalOutputParser } from './outputParser';
import { SessionSnapshotMirror } from './sessionSnapshotMirror';
import { ensurePowerShellIntegrationScript } from './shellIntegration';

interface SessionRecord {
  pty: IPty;
  parser: TerminalOutputParser;
  mirror: SessionSnapshotMirror;
  summary: TerminalSessionSummary;
  observedOutputEvents: number;
  lastActivityAt?: string;
  lastPromptReadyAt?: string;
  lastCompletionReason?: CompletionReason;
}

interface SessionEvents {
  'session-data': { sessionId: string; data: string };
  'session-exit': { sessionId: string; exitCode: number };
  'session-updated': TerminalSessionSummary;
  'session-write': { sessionId: string; data: string; source: TerminalWriteSource; occurredAt: string };
  'session-prompt-ready': { sessionId: string; occurredAt: string };
}

const DEFAULT_COLUMNS = 120;
const DEFAULT_ROWS = 32;
const MIN_COLUMNS = 40;
const MIN_ROWS = 10;

export class TerminalSessionManager extends EventEmitter {
  private readonly preferencesStore: PreferencesStore;
  private readonly integrationScriptPath: string;
  private readonly sessions = new Map<string, SessionRecord>();
  private readonly shellInfo = detectPowerShell();
  private readonly appLogStore?: AppLogStore;

  constructor(preferencesStore: PreferencesStore, appLogStore?: AppLogStore) {
    super();
    this.preferencesStore = preferencesStore;
    this.appLogStore = appLogStore;
    this.integrationScriptPath = ensurePowerShellIntegrationScript();
  }

  getShellLabel(): string {
    return this.shellInfo.label;
  }

  getDefaultCwd(): string {
    return this.preferencesStore.getDefaultWorkspaceCwd();
  }

  getBridgeDimensions(): TerminalDimensions {
    return this.preferencesStore.getBridgeSettings().bridgeDimensions;
  }

  hasSession(sessionId: string): boolean {
    return this.sessions.has(sessionId);
  }

  listSessions(): TerminalSessionSummary[] {
    return [...this.sessions.values()].map((session) => ({ ...session.summary }));
  }

  createSession(options?: CreateSessionOptions): TerminalSessionSummary {
    const sessionId = createId();
    const cwd = options?.cwd ?? this.getDefaultCwd();
    const mode = options?.mode ?? 'desktop';
    const dimensions = resolveDimensions(mode, options?.dimensions);
    const resizeMode: TerminalResizeMode = mode === 'bridge' ? 'fixed' : 'fit';

    const summary: TerminalSessionSummary = {
      id: sessionId,
      slotId: options?.slotId,
      shellLabel: this.shellInfo.label,
      status: 'starting',
      mode,
      resizeMode,
      cols: dimensions.cols,
      rows: dimensions.rows,
      inputLocked: false,
      cwd,
      title: options?.title?.trim() || undefined
    };

    const pty = spawn(
      this.shellInfo.executable,
      ['-NoLogo', '-NoExit', '-ExecutionPolicy', 'Bypass', '-Command', `. '${this.integrationScriptPath}'`],
      {
        name: 'xterm-256color',
        cols: dimensions.cols,
        rows: dimensions.rows,
        cwd,
        useConpty: true,
        env: {
          ...process.env,
          COLORTERM: 'truecolor',
          TERM: 'xterm-256color',
          TERM_PROGRAM: 'multicli-discord-bridge'
        }
      }
    );

    const record: SessionRecord = {
      pty,
      parser: new TerminalOutputParser(),
      mirror: new SessionSnapshotMirror({
        sessionId,
        cols: dimensions.cols,
        rows: dimensions.rows,
        flushTimeoutMs: this.preferencesStore.getBridgeSettings().timing.snapshotMirrorFlushTimeoutMs
      }),
      summary: {
        ...summary,
        status: 'ready'
      },
      observedOutputEvents: 0
    };

    this.sessions.set(sessionId, record);
    this.preferencesStore.setLastCwd(cwd);
    this.emit('session-updated', { ...record.summary });

    pty.onData((data) => {
      const occurredAt = new Date().toISOString();
      record.lastActivityAt = occurredAt;

      const parsed = record.parser.parse(data);
      if (parsed.promptReady) {
        record.lastPromptReadyAt = occurredAt;
        this.emit('session-prompt-ready', { sessionId, occurredAt });
      }

      if (parsed.cwd && parsed.cwd !== record.summary.cwd) {
        record.summary.cwd = parsed.cwd;
        this.preferencesStore.setLastCwd(parsed.cwd);
        this.emit('session-updated', { ...record.summary });
      }

      if (parsed.cleanData.length > 0) {
        record.observedOutputEvents += 1;
        record.mirror.append(parsed.cleanData);
        this.emit('session-data', { sessionId, data: parsed.cleanData });
      }
    });

    pty.onExit(({ exitCode }) => {
      record.summary.status = 'exited';
      record.summary.exitCode = exitCode;
      this.emit('session-updated', { ...record.summary });
      this.emit('session-exit', { sessionId, exitCode });
      record.mirror.dispose();
      this.sessions.delete(sessionId);
    });

    return { ...record.summary };
  }

  write(requestOrSessionId: TerminalWriteRequest | string, data?: string): void {
    const request = normalizeWriteRequest(requestOrSessionId, data);
    const session = this.getSessionRecord(request.sessionId);
    if (!session) {
      return;
    }

    enforceLocalWritePolicy(session.summary, request.source ?? 'local');
    this.logWrite(session.summary, request.data, request.source ?? 'local');
    this.emit('session-write', {
      sessionId: request.sessionId,
      data: request.data,
      source: request.source ?? 'local',
      occurredAt: new Date().toISOString()
    });
    session.pty.write(request.data);
  }

  sendKey(sessionId: string, key: TerminalControlKey, source: TerminalWriteRequest['source'] = 'bridge'): void {
    const payload = toControlSequence(key);
    const session = this.getSessionRecord(sessionId);
    if (session) {
      this.appLogStore?.appendMessage('stdout', `[terminal key] ${describeSession(session.summary)} source=${source} key=${key}\n`);
    }
    this.write({
      sessionId,
      data: payload,
      source
    });
  }

  stopRequest(sessionId: string): void {
    this.sendKey(sessionId, 'ctrl-c', 'system');
  }

  resize(requestOrSessionId: TerminalResizeRequest | string, cols?: number, rows?: number): void {
    const request = normalizeResizeRequest(requestOrSessionId, cols, rows);
    const session = this.getSessionRecord(request.sessionId);
    if (!session) {
      return;
    }

    if (session.summary.resizeMode === 'fixed' && !request.force) {
      return;
    }

    const nextDimensions = sanitizeDimensions(request.cols, request.rows);
    session.pty.resize(nextDimensions.cols, nextDimensions.rows);
    session.mirror.resize(nextDimensions.cols, nextDimensions.rows);
    session.summary.cols = nextDimensions.cols;
    session.summary.rows = nextDimensions.rows;
    this.emit('session-updated', { ...session.summary });
  }

  setInputLock(update: TerminalInputLockUpdate): TerminalSessionSummary {
    const session = this.getSessionRecord(update.sessionId);
    if (!session) {
      throw new Error(`Unknown terminal session: ${update.sessionId}`);
    }

    session.summary.inputLocked = update.locked;
    this.emit('session-updated', { ...session.summary });
    return { ...session.summary };
  }

  applyBridgeSettings(): void {
    const dimensions = this.getBridgeDimensions();
    for (const session of this.sessions.values()) {
      if (session.summary.mode !== 'bridge' || session.summary.status === 'exited') {
        continue;
      }

      session.pty.resize(dimensions.cols, dimensions.rows);
      session.mirror.resize(dimensions.cols, dimensions.rows);
      session.summary.cols = dimensions.cols;
      session.summary.rows = dimensions.rows;
      this.emit('session-updated', { ...session.summary });
    }
  }

  async getSessionState(sessionId: string): Promise<TerminalSessionState> {
    const session = this.getSessionRecord(sessionId);
    if (!session) {
      throw new Error(`Unknown terminal session: ${sessionId}`);
    }

    return session.mirror.getState({
      status: session.summary.status,
      cols: session.summary.cols,
      rows: session.summary.rows,
      mode: session.summary.mode,
      resizeMode: session.summary.resizeMode,
      inputLocked: session.summary.inputLocked,
      lastActivityAt: session.lastActivityAt,
      lastPromptReadyAt: session.lastPromptReadyAt,
      observedOutputEvents: session.observedOutputEvents
    });
  }

  getRawTranscriptOffset(sessionId: string): number {
    const session = this.getSessionRecord(sessionId);
    if (!session) {
      throw new Error(`Unknown terminal session: ${sessionId}`);
    }

    return session.mirror.getRawTranscriptOffset();
  }

  async getRawTranscriptSince(sessionId: string, offset: number): Promise<string> {
    const session = this.getSessionRecord(sessionId);
    if (!session) {
      throw new Error(`Unknown terminal session: ${sessionId}`);
    }

    return session.mirror.getRawTranscriptSince(offset);
  }

  async getBufferSnapshot(sessionId: string, reason: TerminalSnapshotReason = 'manual'): Promise<TerminalSessionSnapshot> {
    const session = this.getSessionRecord(sessionId);
    if (!session) {
      throw new Error(`Unknown terminal session: ${sessionId}`);
    }

    return session.mirror.capture(reason);
  }

  async getVisibleScreenText(sessionId: string, options?: { preserveWrapBoundaries?: boolean }): Promise<string> {
    const session = this.getSessionRecord(sessionId);
    if (!session) {
      throw new Error(`Unknown terminal session: ${sessionId}`);
    }

    return session.mirror.getVisibleScreenText(options);
  }

  async redrawJiggle(request: TerminalRedrawJiggleRequest): Promise<void> {
    const session = this.getSessionRecord(request.sessionId);
    if (!session) {
      throw new Error(`Unknown terminal session: ${request.sessionId}`);
    }

    const timing = this.preferencesStore.getBridgeSettings().timing;
    const waitAfterShrinkMs = request.waitAfterShrinkMs ?? timing.manualRedrawWaitAfterShrinkMs;
    const waitAfterRestoreMs = request.waitAfterRestoreMs ?? timing.manualRedrawWaitAfterRestoreMs;

    this.appLogStore?.appendMessage(
      'stdout',
      `[terminal redraw] ${describeSession(session.summary)} shrinkCols=${request.shrinkCols ?? 1} waitAfterShrinkMs=${waitAfterShrinkMs} waitAfterRestoreMs=${waitAfterRestoreMs}\n`
    );

    const original = {
      cols: session.summary.cols,
      rows: session.summary.rows
    };
    const shrinkBy = Math.max(1, request.shrinkCols ?? 1);
    const shrunk = sanitizeDimensions(original.cols - shrinkBy, original.rows);

    this.resize({
      sessionId: request.sessionId,
      cols: shrunk.cols,
      rows: shrunk.rows,
      source: 'system',
      force: true
    });
    await wait(waitAfterShrinkMs);

    this.resize({
      sessionId: request.sessionId,
      cols: original.cols,
      rows: original.rows,
      source: 'system',
      force: true
    });
    await wait(waitAfterRestoreMs);
  }

  renameSession(sessionId: string, title: string): TerminalSessionSummary {
    const session = this.getSessionRecord(sessionId);
    if (!session) {
      throw new Error(`Unknown terminal session: ${sessionId}`);
    }

    session.summary.title = title.trim() || undefined;
    this.emit('session-updated', { ...session.summary });
    return { ...session.summary };
  }

  closeSession(sessionId: string): void {
    const session = this.getSessionRecord(sessionId);
    if (!session) {
      return;
    }

    session.pty.kill();
  }

  disposeAll(): void {
    for (const sessionId of [...this.sessions.keys()]) {
      this.closeSession(sessionId);
    }
  }

  override on<K extends keyof SessionEvents>(eventName: K, listener: (payload: SessionEvents[K]) => void): this {
    return super.on(eventName, listener);
  }

  private getSessionRecord(sessionId: string): SessionRecord | undefined {
    return this.sessions.get(sessionId);
  }

  private logWrite(summary: TerminalSessionSummary, data: string, source: TerminalWriteSource): void {
    if (isKnownControlSequence(data)) {
      return;
    }

    this.appLogStore?.appendMessage('stdout', `[terminal input] ${describeSession(summary)} source=${source} data=${JSON.stringify(data)}\n`);
  }
}

function resolveDimensions(mode: TerminalSessionMode, partial?: Partial<TerminalDimensions>): TerminalDimensions {
  if (mode === 'bridge') {
    return sanitizeDimensions(partial?.cols ?? DEFAULT_COLUMNS, partial?.rows ?? DEFAULT_ROWS);
  }

  return sanitizeDimensions(partial?.cols ?? DEFAULT_COLUMNS, partial?.rows ?? DEFAULT_ROWS);
}

function sanitizeDimensions(cols: number, rows: number): TerminalDimensions {
  return {
    cols: Math.max(MIN_COLUMNS, Math.floor(cols)),
    rows: Math.max(MIN_ROWS, Math.floor(rows))
  };
}

function normalizeWriteRequest(requestOrSessionId: TerminalWriteRequest | string, data?: string): TerminalWriteRequest {
  if (typeof requestOrSessionId === 'string') {
    return {
      sessionId: requestOrSessionId,
      data: data ?? '',
      source: 'local'
    };
  }

  return {
    source: 'local',
    ...requestOrSessionId
  };
}

function normalizeResizeRequest(
  requestOrSessionId: TerminalResizeRequest | string,
  cols?: number,
  rows?: number
): TerminalResizeRequest {
  if (typeof requestOrSessionId === 'string') {
    return {
      sessionId: requestOrSessionId,
      cols: cols ?? DEFAULT_COLUMNS,
      rows: rows ?? DEFAULT_ROWS,
      source: 'local'
    };
  }

  return {
    source: 'local',
    force: false,
    ...requestOrSessionId
  };
}

function enforceLocalWritePolicy(summary: TerminalSessionSummary, source: TerminalWriteSource): void {
  void summary;
  void source;
}

function isKnownControlSequence(data: string): boolean {
  return data === '\r' || data === '\u0003' || data === '\u001b';
}

function describeSession(summary: TerminalSessionSummary): string {
  const title = summary.title ?? (summary.slotId ? `slot-${summary.slotId}` : summary.id);
  return `session=${summary.id} title=${JSON.stringify(title)}`;
}

function toControlSequence(key: TerminalControlKey): string {
  switch (key) {
    case 'ctrl-c':
      return '\u0003';
    case 'esc':
      return '\u001b';
    case 'enter':
      return '\r';
    case 'up':
      return '\u001b[A';
    case 'down':
      return '\u001b[B';
    case 'right':
      return '\u001b[C';
    case 'left':
      return '\u001b[D';
  }
}

function detectPowerShell(): { executable: string; label: string } {
  const powerShellCore = path.join(process.env.ProgramFiles ?? 'C:\\Program Files', 'PowerShell', '7', 'pwsh.exe');
  if (existsSync(powerShellCore)) {
    return {
      executable: powerShellCore,
      label: 'PowerShell'
    };
  }

  return {
    executable: 'powershell.exe',
    label: 'Windows PowerShell'
  };
}

function createId(): string {
  return `terminal-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function wait(durationMs: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, durationMs);
  });
}
