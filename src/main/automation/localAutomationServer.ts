import { app, type BrowserWindow } from 'electron';
import { mkdirSync, writeFileSync } from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import type { TerminalSessionSnapshot, TerminalSessionState, TerminalSlotId, TerminalWriteSource } from '../../shared/terminal';
import { AppLogStore } from '../app/appLogStore';
import { PreferencesStore } from '../app/preferencesStore';
import { TerminalSlotService } from '../app/terminalSlotService';
import { TerminalAutomationService } from '../bridge/terminalAutomationService';
import { buildTerminalScreenshotFilename, captureTerminalScreenshotPng } from '../bridge/terminalScreenshotCapture';
import { buildWindowScreenshotFilename, captureWindowScreenshotPng } from '../bridge/windowScreenshotCapture';
import { TerminalSessionManager } from '../terminal/terminalSessionManager';

const LOCAL_AUTOMATION_PIPE_PATH = '\\\\.\\pipe\\powershell-discord-bridge-local-automation-v1';
const DEFAULT_DELIVERY_CHECK_DELAY_MS = 3000;
const DEFAULT_TEXT_OBSERVE_MAX_CHARS = 4000;
const OBSERVE_TEXT_TAIL_CHARS = 600;
const OBSERVE_TRANSCRIPT_TAIL_CHARS = 600;

interface LocalAutomationSendTextRequest {
  kind: 'send-text';
  slot: TerminalSlotId;
  text: string;
  pressEnter?: boolean;
  client?: string;
  checkDelivery?: boolean;
  deliveryCheckDelayMs?: number;
}

interface LocalAutomationObserveSlotTextRequest {
  kind: 'observe-slot-text';
  slot: TerminalSlotId;
  maxChars?: number;
}

interface LocalAutomationObserveSlotScreenshotRequest {
  kind: 'observe-slot-screenshot';
  slot: TerminalSlotId;
}

interface LocalAutomationObserveWindowScreenshotRequest {
  kind: 'observe-window-screenshot';
}

type LocalAutomationRequest =
  | LocalAutomationSendTextRequest
  | LocalAutomationObserveSlotTextRequest
  | LocalAutomationObserveSlotScreenshotRequest
  | LocalAutomationObserveWindowScreenshotRequest;

interface LocalAutomationDeliveryCheck {
  verdict: 'likely_delivered' | 'uncertain' | 'likely_not_delivered';
  waitedMs: number;
  reasons: string[];
  submittedTextVisible: boolean;
  screenChanged: boolean;
  transcriptGrew: boolean;
  outputEventsIncreased: boolean;
  lastActivityChanged: boolean;
  beforeHash: string;
  afterHash: string;
  beforeRevision: number;
  afterRevision: number;
  beforeTranscriptLength: number;
  afterTranscriptLength: number;
  visibleTail: string;
  transcriptTail: string;
}

interface LocalAutomationSendTextResponse {
  ok: true;
  kind: 'send-text';
  slot: TerminalSlotId;
  sessionId: string;
  title?: string;
  cwd?: string;
  pressEnter: boolean;
  textLength: number;
  acceptedAt: string;
  deliveryCheck?: LocalAutomationDeliveryCheck;
}

interface LocalAutomationObserveSlotTextResponse {
  ok: true;
  kind: 'observe-slot-text';
  slot: TerminalSlotId;
  sessionId: string;
  title?: string;
  cwd?: string;
  capturedAt: string;
  screenText: string;
  truncated: boolean;
  fullLength: number;
  lineCount: number;
  hash: string;
  screenRevision: number;
  rawTranscriptLength: number;
  observedOutputEvents: number;
  inputLocked: boolean;
  lastActivityAt?: string;
  lastPromptReadyAt?: string;
}

interface LocalAutomationScreenshotResponse {
  ok: true;
  kind: 'observe-slot-screenshot' | 'observe-window-screenshot';
  slot?: TerminalSlotId;
  sessionId?: string;
  title?: string;
  cwd?: string;
  capturedAt: string;
  filePath: string;
}

interface LocalAutomationErrorResponse {
  ok: false;
  error: string;
}

type LocalAutomationResponse =
  | LocalAutomationSendTextResponse
  | LocalAutomationObserveSlotTextResponse
  | LocalAutomationScreenshotResponse
  | LocalAutomationErrorResponse;

export class LocalAutomationServer {
  private server?: net.Server;

  constructor(
    private readonly terminalSlotService: TerminalSlotService,
    private readonly terminalAutomationService: TerminalAutomationService,
    private readonly terminalSessionManager: TerminalSessionManager,
    private readonly preferencesStore: PreferencesStore,
    private readonly getMainWindow: () => BrowserWindow | undefined,
    private readonly appLogStore?: AppLogStore
  ) {}

  start(): void {
    if (this.server) {
      return;
    }

    const server = net.createServer((socket) => {
      socket.setEncoding('utf8');
      let payload = '';
      let handled = false;

      socket.on('data', (chunk) => {
        if (handled) {
          return;
        }

        payload += chunk;
        const newlineIndex = payload.indexOf('\n');
        if (newlineIndex === -1) {
          return;
        }

        handled = true;
        void this.respond(socket, payload.slice(0, newlineIndex));
      });

      socket.on('error', (error) => {
        this.log(`socket error: ${formatError(error)}`);
      });

      socket.on('end', () => {
        if (handled || payload.trim().length === 0) {
          return;
        }

        handled = true;
        void this.respond(socket, payload);
      });
    });

    server.on('error', (error) => {
      this.log(`server error: ${formatError(error)}`);
    });

    server.listen(LOCAL_AUTOMATION_PIPE_PATH, () => {
      this.log(`started pipe=${LOCAL_AUTOMATION_PIPE_PATH}`);
    });

    this.server = server;
  }

  stop(): void {
    if (!this.server) {
      return;
    }

    this.server.close();
    this.server = undefined;
    this.log('stopped');
  }

  private async respond(socket: net.Socket, payload: string): Promise<void> {
    const response = await this.handlePayload(payload);
    socket.end(`${JSON.stringify(response)}\n`);
  }

  private async handlePayload(payload: string): Promise<LocalAutomationResponse> {
    try {
      const request = parseRequest(payload);
      switch (request.kind) {
        case 'send-text':
          return await this.handleSendText(request);
        case 'observe-slot-text':
          return await this.handleObserveSlotText(request);
        case 'observe-slot-screenshot':
          return await this.handleObserveSlotScreenshot(request);
        case 'observe-window-screenshot':
          return await this.handleObserveWindowScreenshot();
      }
    } catch (error) {
      const message = formatError(error);
      this.log(`rejected error=${JSON.stringify(message)}`);
      return {
        ok: false,
        error: message
      };
    }
  }

  private async handleSendText(request: LocalAutomationSendTextRequest): Promise<LocalAutomationSendTextResponse> {
    const session = this.terminalSlotService.ensureSession(request.slot);
    const source: TerminalWriteSource = 'automation';
    const acceptedAt = new Date().toISOString();
    const beforeSnapshot = await this.terminalSessionManager.getBufferSnapshot(session.id, 'manual');
    const beforeState = await this.terminalSessionManager.getSessionState(session.id);
    const beforeTranscriptOffset = this.terminalSessionManager.getRawTranscriptOffset(session.id);
    const pressEnter = request.pressEnter ?? true;

    await this.terminalAutomationService.sendInput({
      sessionId: session.id,
      content: request.text,
      appendEnter: pressEnter,
      source
    });

    this.log(
      `accepted kind=send-text slot=${request.slot} session=${session.id} pressEnter=${pressEnter} textLength=${request.text.length} client=${JSON.stringify(
        request.client ?? 'unknown'
      )}`
    );

    return {
      ok: true,
      kind: 'send-text',
      slot: request.slot,
      sessionId: session.id,
      title: session.title,
      cwd: session.cwd,
      pressEnter,
      textLength: request.text.length,
      acceptedAt,
      deliveryCheck:
        request.checkDelivery === false
          ? undefined
          : await this.performDeliveryCheck(
              session.id,
              request.text,
              sanitizePositiveInteger(request.deliveryCheckDelayMs, DEFAULT_DELIVERY_CHECK_DELAY_MS),
              beforeSnapshot,
              beforeState,
              beforeTranscriptOffset
            )
    };
  }

  private async handleObserveSlotText(request: LocalAutomationObserveSlotTextRequest): Promise<LocalAutomationObserveSlotTextResponse> {
    const session = this.terminalSlotService.ensureSession(request.slot);
    const [snapshot, state] = await Promise.all([
      this.terminalSessionManager.getBufferSnapshot(session.id, 'manual'),
      this.terminalSessionManager.getSessionState(session.id)
    ]);
    const maxChars = sanitizePositiveInteger(request.maxChars, DEFAULT_TEXT_OBSERVE_MAX_CHARS);
    const truncatedText = truncateTail(snapshot.screenText, maxChars);

    this.log(`accepted kind=observe-slot-text slot=${request.slot} session=${session.id} maxChars=${maxChars}`);

    return {
      ok: true,
      kind: 'observe-slot-text',
      slot: request.slot,
      sessionId: session.id,
      title: session.title,
      cwd: session.cwd,
      capturedAt: new Date().toISOString(),
      screenText: truncatedText,
      truncated: truncatedText.length < snapshot.screenText.length,
      fullLength: snapshot.screenText.length,
      lineCount: snapshot.lineCount,
      hash: snapshot.hash,
      screenRevision: snapshot.screenRevision,
      rawTranscriptLength: state.rawTranscriptLength,
      observedOutputEvents: state.observedOutputEvents,
      inputLocked: state.inputLocked,
      lastActivityAt: state.lastActivityAt,
      lastPromptReadyAt: state.lastPromptReadyAt
    };
  }

  private async handleObserveSlotScreenshot(
    request: LocalAutomationObserveSlotScreenshotRequest
  ): Promise<LocalAutomationScreenshotResponse> {
    const session = this.terminalSlotService.ensureSession(request.slot);
    const capturedAt = new Date().toISOString();
    const png = await captureTerminalScreenshotPng(session.id, this.getTerminalScreenshotTiming());
    const filePath = this.writeCaptureFile(buildTerminalScreenshotFilename(capturedAt), png, request.slot);

    this.log(`accepted kind=observe-slot-screenshot slot=${request.slot} session=${session.id} file=${JSON.stringify(filePath)}`);

    return {
      ok: true,
      kind: 'observe-slot-screenshot',
      slot: request.slot,
      sessionId: session.id,
      title: session.title,
      cwd: session.cwd,
      capturedAt,
      filePath
    };
  }

  private async handleObserveWindowScreenshot(): Promise<LocalAutomationScreenshotResponse> {
    const mainWindow = this.getMainWindow();
    if (!mainWindow) {
      throw new Error('Main window is not available for screenshot capture.');
    }

    const capturedAt = new Date().toISOString();
    const png = await captureWindowScreenshotPng(mainWindow, this.preferencesStore.getBridgeSettings().timing.windowScreenshotCaptureDelayMs);
    const filePath = this.writeCaptureFile(buildWindowScreenshotFilename(capturedAt), png);

    this.log(`accepted kind=observe-window-screenshot file=${JSON.stringify(filePath)}`);

    return {
      ok: true,
      kind: 'observe-window-screenshot',
      capturedAt,
      filePath
    };
  }

  private async performDeliveryCheck(
    sessionId: string,
    submittedText: string,
    waitMs: number,
    beforeSnapshot: TerminalSessionSnapshot,
    beforeState: TerminalSessionState,
    beforeTranscriptOffset: number
  ): Promise<LocalAutomationDeliveryCheck> {
    await wait(waitMs);

    const [afterSnapshot, afterState, transcriptDelta] = await Promise.all([
      this.terminalSessionManager.getBufferSnapshot(sessionId, 'manual'),
      this.terminalSessionManager.getSessionState(sessionId),
      this.terminalSessionManager.getRawTranscriptSince(sessionId, beforeTranscriptOffset)
    ]);

    const submittedTextVisible = isSubmittedTextVisible(submittedText, afterSnapshot.screenText);
    const screenChanged =
      beforeSnapshot.hash !== afterSnapshot.hash || beforeSnapshot.screenRevision !== afterSnapshot.screenRevision;
    const transcriptGrew = transcriptDelta.length > 0;
    const outputEventsIncreased = afterState.observedOutputEvents > beforeState.observedOutputEvents;
    const lastActivityChanged =
      typeof afterState.lastActivityAt === 'string' &&
      afterState.lastActivityAt.length > 0 &&
      afterState.lastActivityAt !== beforeState.lastActivityAt;

    const reasons = [];
    if (submittedTextVisible) {
      reasons.push('submitted_text_visible');
    }
    if (screenChanged) {
      reasons.push('screen_changed');
    }
    if (transcriptGrew) {
      reasons.push('transcript_grew');
    }
    if (outputEventsIncreased) {
      reasons.push('output_events_increased');
    }
    if (lastActivityChanged) {
      reasons.push('last_activity_changed');
    }

    let verdict: LocalAutomationDeliveryCheck['verdict'];
    if (
      submittedTextVisible ||
      (screenChanged && transcriptGrew) ||
      (screenChanged && outputEventsIncreased) ||
      (transcriptGrew && outputEventsIncreased)
    ) {
      verdict = 'likely_delivered';
    } else if (screenChanged || transcriptGrew || outputEventsIncreased || lastActivityChanged) {
      verdict = 'uncertain';
    } else {
      verdict = 'likely_not_delivered';
    }

    return {
      verdict,
      waitedMs: waitMs,
      reasons,
      submittedTextVisible,
      screenChanged,
      transcriptGrew,
      outputEventsIncreased,
      lastActivityChanged,
      beforeHash: beforeSnapshot.hash,
      afterHash: afterSnapshot.hash,
      beforeRevision: beforeSnapshot.screenRevision,
      afterRevision: afterSnapshot.screenRevision,
      beforeTranscriptLength: beforeState.rawTranscriptLength,
      afterTranscriptLength: afterState.rawTranscriptLength,
      visibleTail: truncateTail(afterSnapshot.screenText, OBSERVE_TEXT_TAIL_CHARS),
      transcriptTail: truncateTail(transcriptDelta, OBSERVE_TRANSCRIPT_TAIL_CHARS)
    };
  }

  private getTerminalScreenshotTiming() {
    const timing = this.preferencesStore.getBridgeSettings().timing;
    return {
      readyTimeoutMs: timing.terminalScreenshotReadyTimeoutMs,
      pollIntervalMs: timing.terminalScreenshotPollIntervalMs,
      resizeSettleMs: timing.terminalScreenshotResizeSettleMs
    };
  }

  private writeCaptureFile(filename: string, contents: Buffer, slot?: TerminalSlotId): string {
    const dateFolder = new Date().toISOString().slice(0, 10);
    const captureRoot = path.join(app.getPath('userData'), 'automation-captures', dateFolder, slot ? `slot-${slot}` : 'window');
    mkdirSync(captureRoot, { recursive: true });
    const filePath = path.join(captureRoot, filename);
    writeFileSync(filePath, contents);
    return filePath;
  }

  private log(message: string): void {
    this.appLogStore?.appendMessage('stdout', `[local automation] ${message}\n`);
  }
}

function parseRequest(payload: string): LocalAutomationRequest {
  const trimmedPayload = payload.trim();
  if (!trimmedPayload) {
    throw new Error('Local automation request payload is empty.');
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmedPayload);
  } catch (error) {
    throw new Error(`Invalid local automation JSON: ${formatError(error)}`);
  }

  if (!isRecord(parsed)) {
    throw new Error('Local automation request must be a JSON object.');
  }

  switch (parsed.kind) {
    case 'send-text':
      return parseSendTextRequest(parsed);
    case 'observe-slot-text':
      return parseObserveSlotTextRequest(parsed);
    case 'observe-slot-screenshot':
      return parseObserveSlotScreenshotRequest(parsed);
    case 'observe-window-screenshot':
      return { kind: 'observe-window-screenshot' };
    default:
      throw new Error('Unsupported local automation request kind.');
  }
}

function parseSendTextRequest(parsed: Record<string, unknown>): LocalAutomationSendTextRequest {
  const slot = parseSlot(parsed.slot);
  const text = typeof parsed.text === 'string' ? parsed.text : '';
  if (text.length === 0) {
    throw new Error('Text is required.');
  }

  ensureOptionalBoolean(parsed.pressEnter, 'pressEnter');
  ensureOptionalBoolean(parsed.checkDelivery, 'checkDelivery');
  ensureOptionalString(parsed.client, 'client');
  ensureOptionalNumber(parsed.deliveryCheckDelayMs, 'deliveryCheckDelayMs');

  return {
    kind: 'send-text',
    slot,
    text,
    pressEnter: parsed.pressEnter as boolean | undefined,
    client: parsed.client as string | undefined,
    checkDelivery: parsed.checkDelivery as boolean | undefined,
    deliveryCheckDelayMs: parsed.deliveryCheckDelayMs as number | undefined
  };
}

function parseObserveSlotTextRequest(parsed: Record<string, unknown>): LocalAutomationObserveSlotTextRequest {
  ensureOptionalNumber(parsed.maxChars, 'maxChars');
  return {
    kind: 'observe-slot-text',
    slot: parseSlot(parsed.slot),
    maxChars: parsed.maxChars as number | undefined
  };
}

function parseObserveSlotScreenshotRequest(parsed: Record<string, unknown>): LocalAutomationObserveSlotScreenshotRequest {
  return {
    kind: 'observe-slot-screenshot',
    slot: parseSlot(parsed.slot)
  };
}

function parseSlot(value: unknown): TerminalSlotId {
  if (value === 1 || value === 2 || value === 3 || value === 4) {
    return value;
  }

  throw new Error('slot must be 1, 2, 3, or 4.');
}

function ensureOptionalBoolean(value: unknown, fieldName: string): void {
  if (typeof value !== 'undefined' && typeof value !== 'boolean') {
    throw new Error(`${fieldName} must be a boolean when provided.`);
  }
}

function ensureOptionalString(value: unknown, fieldName: string): void {
  if (typeof value !== 'undefined' && typeof value !== 'string') {
    throw new Error(`${fieldName} must be a string when provided.`);
  }
}

function ensureOptionalNumber(value: unknown, fieldName: string): void {
  if (typeof value !== 'undefined' && typeof value !== 'number') {
    throw new Error(`${fieldName} must be a number when provided.`);
  }
}

function sanitizePositiveInteger(value: number | undefined, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return fallback;
  }

  return Math.max(0, Math.trunc(value));
}

function truncateTail(value: string, maxChars: number): string {
  if (value.length <= maxChars) {
    return value;
  }

  return value.slice(value.length - maxChars);
}

function isSubmittedTextVisible(submittedText: string, screenText: string): boolean {
  const normalizedSubmitted = normalizeComparableText(submittedText);
  if (!normalizedSubmitted) {
    return false;
  }

  return normalizeComparableText(screenText).includes(normalizedSubmitted);
}

function normalizeComparableText(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function wait(durationMs: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, durationMs);
  });
}
