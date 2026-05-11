import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type {
  TerminalAutomationTurnRequest,
  TerminalAutomationTurnResult,
  TerminalControlKey,
  TerminalSendInputRequest,
  TerminalSessionSnapshot,
  TerminalWaitForCompletionRequest,
  TerminalWaitForCompletionResult,
  TerminalWriteSource
} from '../../shared/terminal';
import { PreferencesStore } from '../app/preferencesStore';
import { TerminalSessionManager } from '../terminal/terminalSessionManager';
import type { BridgeRuntimeConfig } from './bridgeConfig';
import { DiscordReplyFormatter } from './discordReplyFormatter';
import { TerminalDiffService } from './terminalDiffService';

export class TerminalAutomationService {
  private readonly diffService = new TerminalDiffService();
  private readonly replyFormatter: DiscordReplyFormatter;
  private readonly abortRequestedSessions = new Set<string>();

  constructor(
    private readonly terminalSessionManager: TerminalSessionManager,
    private readonly config: BridgeRuntimeConfig,
    private readonly preferencesStore: PreferencesStore
  ) {
    this.replyFormatter = new DiscordReplyFormatter(config.reply);
  }

  async sendInput(request: TerminalSendInputRequest): Promise<void> {
    const source = request.source ?? 'bridge';
    if (request.content) {
      this.terminalSessionManager.write({
        sessionId: request.sessionId,
        data: request.content,
        source
      });
    }

    if (request.appendEnter ?? true) {
      if (request.content) {
        await wait(TEXT_SUBMIT_ENTER_DELAY_MS);
      }

      this.terminalSessionManager.sendKey(request.sessionId, 'enter', source);
    }
  }

  async waitForCompletion(request: TerminalWaitForCompletionRequest): Promise<TerminalWaitForCompletionResult> {
    const startedAt = Date.now();
    const expectOutput = request.expectOutput ?? true;
    const bridgeSettings = this.preferencesStore.getBridgeSettings();
    const stablePollTarget = request.stablePollCount ?? this.config.completion.stablePollCount;
    const settleMs = request.settleMs ?? this.config.completion.settleMs;
    const softTimeoutMs = request.softTimeoutMs ?? bridgeSettings.softTimeoutMs;
    const noOutputTimeoutMs = request.noOutputTimeoutMs ?? this.config.completion.noOutputTimeoutMs;
    const hardTimeoutMs = request.hardTimeoutMs ?? bridgeSettings.hardTimeoutMs;
    const pollIntervalMs = request.pollIntervalMs ?? this.config.completion.pollIntervalMs;
    const baselinePromptReadyAt = request.baselinePromptReadyAt;
    const baselineObservedOutputEvents = request.baselineObservedOutputEvents ?? 0;

    let stablePollCount = 0;
    let previousHash: string | undefined;

    while (true) {
      const state = await this.terminalSessionManager.getSessionState(request.sessionId);
      const snapshot = await this.terminalSessionManager.getBufferSnapshot(request.sessionId, 'manual');
      const now = Date.now();
      const elapsed = now - startedAt;
      const idleMs = state.lastActivityAt ? Math.max(0, now - Date.parse(state.lastActivityAt)) : Number.POSITIVE_INFINITY;
      const observedOutput = state.observedOutputEvents > baselineObservedOutputEvents;
      const submittedTextPending = isSubmittedTextPending(snapshot.screenText, request.submittedTextProbe);
      const hasPromptReady =
        isAfter(state.lastPromptReadyAt, baselinePromptReadyAt) ||
        hasInteractivePromptReady(snapshot.screenText, request.submittedTextProbe, observedOutput);
      const abortRequested = this.abortRequestedSessions.has(request.sessionId);

      if (snapshot.hash === previousHash) {
        stablePollCount += 1;
      } else {
        previousHash = snapshot.hash;
        stablePollCount = 1;
      }

      const isStable = stablePollCount >= stablePollTarget;
      if (state.status === 'exited') {
        if (abortRequested) {
          return buildCompletionResult(request.sessionId, 'aborted', true, snapshot, state);
        }

        return buildCompletionResult(request.sessionId, 'hard_timeout_failed', false, snapshot, state);
      }

      if (abortRequested) {
        if (hasPromptReady && isStable) {
          return buildCompletionResult(request.sessionId, 'aborted', true, snapshot, state);
        }

        if (elapsed >= noOutputTimeoutMs && (hasPromptReady || isStable)) {
          return buildCompletionResult(request.sessionId, 'aborted', true, snapshot, state);
        }
      }

      if (!expectOutput) {
        if (hasPromptReady && isStable) {
          return buildCompletionResult(request.sessionId, 'prompt_ready', true, snapshot, state);
        }

        if (elapsed >= noOutputTimeoutMs && (hasPromptReady || isStable)) {
          return buildCompletionResult(request.sessionId, 'no_output_timeout', true, snapshot, state);
        }
      } else {
        if (hasPromptReady && isStable && idleMs >= settleMs && observedOutput && !submittedTextPending) {
          return buildCompletionResult(request.sessionId, 'prompt_ready', true, snapshot, state);
        }

        if (elapsed >= softTimeoutMs && isStable && idleMs >= settleMs && observedOutput && !submittedTextPending) {
          return buildCompletionResult(request.sessionId, 'soft_timeout_stable', true, snapshot, state);
        }

        if (elapsed >= softTimeoutMs && isStable && idleMs >= settleMs && (!observedOutput || submittedTextPending)) {
          return buildCompletionResult(request.sessionId, 'no_output_timeout', false, snapshot, state);
        }
      }

      if (elapsed >= hardTimeoutMs) {
        return buildCompletionResult(request.sessionId, 'hard_timeout_failed', false, snapshot, state);
      }

      await wait(pollIntervalMs);
    }
  }

  async runAutomationTurn(request: TerminalAutomationTurnRequest): Promise<TerminalAutomationTurnResult> {
    this.clearAbort(request.sessionId);
    const beforeSnapshot = request.captureBefore === false ? undefined : await this.captureSnapshot(request.sessionId, 'before-send', true);
    const baselineState = await this.terminalSessionManager.getSessionState(request.sessionId);
    const baselineRawOffset = this.terminalSessionManager.getRawTranscriptOffset(request.sessionId);

    if (request.kind === 'text') {
      await this.sendInput({
        sessionId: request.sessionId,
        content: request.content ?? '',
        appendEnter: true,
        source: 'bridge'
      });
    } else {
      const key = request.key ?? 'enter';
      this.terminalSessionManager.sendKey(request.sessionId, key, 'bridge');
    }

    const completion = await this.waitForCompletion({
      sessionId: request.sessionId,
      expectOutput: request.expectOutput ?? request.kind === 'text',
      submittedTextProbe: request.kind === 'text' ? buildSubmittedTextProbe(request.content) : undefined,
      baselinePromptReadyAt: baselineState.lastPromptReadyAt,
      baselineRawOutputOffset: baselineRawOffset,
      baselineObservedOutputEvents: baselineState.observedOutputEvents
    });

    const afterSnapshot = request.captureAfter === false ? undefined : await this.captureSnapshot(request.sessionId, 'after-complete', true);
    const rawOutput = await this.terminalSessionManager.getRawTranscriptSince(request.sessionId, baselineRawOffset);
    const diff = this.diffService.buildDiff({
      beforeSnapshot,
      afterSnapshot: afterSnapshot ?? (await this.captureSnapshot(request.sessionId, 'manual', false)),
      rawOutput,
      tailChars: this.config.diff.tailChars,
      fallbackLines: this.config.diff.fallbackLines
    });
    const replyChunks = this.replyFormatter.format(diff.diffText);

    return {
      beforeSnapshot,
      afterSnapshot,
      rawOutput,
      diff,
      replyChunks,
      completion
    };
  }

  async captureSnapshot(
    sessionId: string,
    reason: TerminalSessionSnapshot['reason'],
    redraw: boolean
  ): Promise<TerminalSessionSnapshot> {
    if (redraw) {
      await this.terminalSessionManager.redrawJiggle({
        sessionId,
        shrinkCols: 1,
        waitAfterShrinkMs: 150,
        waitAfterRestoreMs: 250
      });
    }

    const snapshot = await this.terminalSessionManager.getBufferSnapshot(sessionId, reason);
    this.persistSnapshot(snapshot);
    return snapshot;
  }

  softStop(sessionId: string): void {
    this.requestAbort(sessionId);
  }

  requestAbort(sessionId: string): void {
    this.abortRequestedSessions.add(sessionId);
    this.terminalSessionManager.stopRequest(sessionId);
  }

  clearAbort(sessionId: string): void {
    this.abortRequestedSessions.delete(sessionId);
  }

  sendControlKey(sessionId: string, key: TerminalControlKey, source: TerminalWriteSource = 'bridge'): void {
    this.terminalSessionManager.sendKey(sessionId, key, source);
  }

  setInputLock(sessionId: string, locked: boolean) {
    return this.terminalSessionManager.setInputLock({
      sessionId,
      locked
    });
  }

  private persistSnapshot(snapshot: TerminalSessionSnapshot): void {
    mkdirSync(this.config.storage.snapshotDirectory, { recursive: true });
    const filename = `${snapshot.sessionId}-${snapshot.capturedAt.replace(/[:.]/g, '-')}-${snapshot.reason}.json`;
    const filePath = path.join(this.config.storage.snapshotDirectory, filename);
    writeFileSync(filePath, JSON.stringify(snapshot, null, 2), 'utf8');
  }
}

function buildCompletionResult(
  sessionId: string,
  reason: TerminalWaitForCompletionResult['reason'],
  success: boolean,
  snapshot: TerminalSessionSnapshot,
  state: Awaited<ReturnType<TerminalSessionManager['getSessionState']>>
): TerminalWaitForCompletionResult {
  return {
    sessionId,
    success,
    reason,
    completedAt: new Date().toISOString(),
    screenRevision: snapshot.screenRevision,
    snapshotHash: snapshot.hash,
    observedOutputEvents: state.observedOutputEvents,
    rawTranscriptLength: state.rawTranscriptLength,
    lastActivityAt: state.lastActivityAt,
    lastPromptReadyAt: state.lastPromptReadyAt
  };
}

function isAfter(candidate?: string, baseline?: string): boolean {
  if (!candidate) {
    return false;
  }

  if (!baseline) {
    return true;
  }

  return Date.parse(candidate) > Date.parse(baseline);
}

function buildSubmittedTextProbe(content?: string): string | undefined {
  const normalized = normalizeComparisonText(content);
  if (!normalized) {
    return undefined;
  }

  return normalized.slice(0, 80);
}

function hasInteractivePromptReady(screenText: string, submittedTextProbe: string | undefined, observedOutput: boolean): boolean {
  if (!observedOutput) {
    return false;
  }

  if (!GEMINI_PROMPT_MARKERS.some((marker) => screenText.includes(marker))) {
    return false;
  }

  if (!submittedTextProbe) {
    return true;
  }

  return !isSubmittedTextPending(screenText, submittedTextProbe);
}

function isSubmittedTextPending(screenText: string, submittedTextProbe: string | undefined): boolean {
  if (!submittedTextProbe) {
    return false;
  }

  const normalizedProbe = normalizeComparisonText(submittedTextProbe);
  if (!normalizedProbe) {
    return false;
  }

  return extractPendingInputCandidates(screenText).some((candidate) =>
    normalizeComparisonText(candidate).includes(normalizedProbe)
  );
}

const GEMINI_PROMPT_MARKERS = ['Type your message or @path/to/file'];
const TEXT_SUBMIT_ENTER_DELAY_MS = 75;

function extractPendingInputCandidates(screenText: string): string[] {
  const lines = screenText.split('\n');
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    if (!isGeminiInputLine(lines[index])) {
      continue;
    }

    const block = [lines[index]];
    for (let nextIndex = index + 1; nextIndex < lines.length; nextIndex += 1) {
      const nextLine = lines[nextIndex];
      if (!nextLine.trim() || isGeminiInputLine(nextLine) || isGeminiFooterLine(nextLine)) {
        break;
      }

      block.push(nextLine);
    }

    return [block.join(' ')];
  }

  return [];
}

function isGeminiInputLine(line: string): boolean {
  const trimmedStart = line.trimStart();
  return trimmedStart.startsWith('>') && trimmedStart.length > 1;
}

function isGeminiFooterLine(line: string): boolean {
  const trimmed = line.trim();
  return trimmed.startsWith('▄▄') || trimmed.startsWith('workspace ') || trimmed.startsWith('~\\');
}

function normalizeComparisonText(value?: string): string {
  return value?.replace(/\s+/g, ' ').trim() ?? '';
}

function wait(durationMs: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, durationMs);
  });
}
