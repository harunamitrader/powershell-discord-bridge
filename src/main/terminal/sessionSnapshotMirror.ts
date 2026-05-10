import { createHash } from 'node:crypto';
import { Terminal } from '@xterm/headless';
import type { TerminalDimensions, TerminalSessionSnapshot, TerminalSessionState, TerminalSnapshotReason } from '../../shared/terminal';

interface SnapshotMirrorOptions extends TerminalDimensions {
  sessionId: string;
}

export class SessionSnapshotMirror {
  private readonly sessionId: string;
  private readonly terminal: Terminal;
  private rawTranscript = '';
  private screenRevision = 0;
  private lastSnapshotHash: string | undefined;
  private writeChain = Promise.resolve();

  constructor(options: SnapshotMirrorOptions) {
    this.sessionId = options.sessionId;
    this.terminal = new Terminal({
      allowProposedApi: true,
      cols: options.cols,
      rows: options.rows,
      scrollback: 100000
    });
  }

  append(data: string): void {
    if (!data) {
      return;
    }

    this.rawTranscript += data;
    this.writeChain = this.writeChain.then(
      () =>
        new Promise<void>((resolve) => {
          this.terminal.write(data, () => {
            this.screenRevision += 1;
            resolve();
          });
        })
    );
  }

  resize(cols: number, rows: number): void {
    this.writeChain = this.writeChain.then(async () => {
      this.terminal.resize(cols, rows);
      this.screenRevision += 1;
    });
  }

  async capture(reason: TerminalSnapshotReason): Promise<TerminalSessionSnapshot> {
    await this.flush('capture');

    const screenText = serializeBuffer(this.terminal.buffer.active);
    const capturedAt = new Date().toISOString();
    const hash = createHash('sha256').update(screenText).digest('hex');
    this.lastSnapshotHash = hash;

    return {
      snapshotId: `${this.sessionId}-${Date.now().toString(36)}`,
      sessionId: this.sessionId,
      capturedAt,
      reason,
      source: 'headless-mirror',
      serializationFormat: 'xterm-screen-v1',
      cols: this.terminal.cols,
      rows: this.terminal.rows,
      screenText,
      screenRevision: this.screenRevision,
      lineCount: countLines(screenText),
      hash,
      rawTranscriptLength: this.rawTranscript.length
    };
  }

  async getState(summary: {
    status: TerminalSessionState['status'];
    cols: number;
    rows: number;
    mode: TerminalSessionState['mode'];
    resizeMode: TerminalSessionState['resizeMode'];
    inputLocked: boolean;
    lastActivityAt?: string;
    lastPromptReadyAt?: string;
    observedOutputEvents: number;
  }): Promise<TerminalSessionState> {
    await this.flush('getState');

    return {
      sessionId: this.sessionId,
      status: summary.status,
      cols: summary.cols,
      rows: summary.rows,
      mode: summary.mode,
      resizeMode: summary.resizeMode,
      inputLocked: summary.inputLocked,
      activeBufferType: this.terminal.buffer.active.type,
      screenRevision: this.screenRevision,
      observedOutputEvents: summary.observedOutputEvents,
      rawTranscriptLength: this.rawTranscript.length,
      lastSnapshotHash: this.lastSnapshotHash,
      lastActivityAt: summary.lastActivityAt,
      lastPromptReadyAt: summary.lastPromptReadyAt
    };
  }

  getRawTranscriptOffset(): number {
    return this.rawTranscript.length;
  }

  async getRawTranscriptSince(offset: number): Promise<string> {
    return this.rawTranscript.slice(Math.max(0, offset));
  }

  dispose(): void {
    this.terminal.dispose();
  }

  private async flush(operation: 'capture' | 'getState'): Promise<void> {
    const timedOut = await Promise.race([
      this.writeChain.then(() => false),
      wait(MIRROR_FLUSH_TIMEOUT_MS).then(() => true)
    ]);

    if (timedOut) {
      console.warn(
        `Session snapshot mirror flush timed out for ${this.sessionId} during ${operation}; using last available screen state.`
      );
    }
  }
}

const MIRROR_FLUSH_TIMEOUT_MS = 2000;

function wait(durationMs: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, durationMs);
  });
}

function serializeBuffer(buffer: Terminal['buffer']['active']): string {
  let result = '';

  for (let index = 0; index < buffer.length; index += 1) {
    const line = buffer.getLine(index);
    const text = line?.translateToString(true) ?? '';
    if (index === 0) {
      result = text;
      continue;
    }

    if (line?.isWrapped) {
      result += text;
      continue;
    }

    result += `\n${text}`;
  }

  return result;
}

function countLines(text: string): number {
  if (text.length === 0) {
    return 0;
  }

  return text.split('\n').length;
}
