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
import { extractComparableLineDiff, isComparableCharacter, normalizeTerminalText } from './replyTextDiff';
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
    const promoteToOutputOnMeaningfulChange = request.promoteToOutputOnMeaningfulChange ?? false;
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
    let promotedToOutputWait = false;

    while (true) {
      const state = await this.terminalSessionManager.getSessionState(request.sessionId);
      const snapshot = await this.terminalSessionManager.getBufferSnapshot(request.sessionId, 'manual');
      const now = Date.now();
      const elapsed = now - startedAt;
      const idleMs = state.lastActivityAt ? Math.max(0, now - Date.parse(state.lastActivityAt)) : Number.POSITIVE_INFINITY;
      const observedOutput = state.observedOutputEvents > baselineObservedOutputEvents;
      const pendingInputDetected = hasPendingGeminiInput(snapshot.screenText);
      const submittedTextPending = pendingInputDetected && isSubmittedTextPending(snapshot.screenText, request.submittedTextProbe);
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
      const hasStableObservedOutput = isStable && idleMs >= settleMs && observedOutput;
      const hasMeaningfulVisibleChange = hasMeaningfulReplyText({
        beforeText: request.beforeScreenText,
        afterText: snapshot.screenText,
        submittedText: request.submittedText
      });
      const hasMeaningfulChangeSignal = observedOutput || hasMeaningfulVisibleChange;
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

      if (!expectOutput && promoteToOutputOnMeaningfulChange && hasMeaningfulChangeSignal) {
        promotedToOutputWait = true;
      }

      if (!expectOutput && !promotedToOutputWait) {
        if (hasPromptReady && isStable) {
          return buildCompletionResult(request.sessionId, 'prompt_ready', true, snapshot, state);
        }

        if (elapsed >= noOutputTimeoutMs && (hasPromptReady || isStable)) {
          return buildCompletionResult(request.sessionId, 'no_output_timeout', true, snapshot, state);
        }
      } else if (expectOutput) {
        if (hasPromptReady && isStable && idleMs >= settleMs && observedOutput && !pendingInputDetected && !submittedTextPending) {
          return buildCompletionResult(request.sessionId, 'prompt_ready', true, snapshot, state);
        }

        if (elapsed >= noOutputTimeoutMs && hasStableObservedOutput && hasMeaningfulVisibleChange) {
          return buildCompletionResult(request.sessionId, 'idle_stable', true, snapshot, state);
        }

        if (elapsed >= softTimeoutMs && hasStableObservedOutput && hasMeaningfulVisibleChange) {
          return buildCompletionResult(request.sessionId, 'soft_timeout_stable', true, snapshot, state);
        }

        if (elapsed >= softTimeoutMs && isStable && idleMs >= settleMs && (!observedOutput || pendingInputDetected || submittedTextPending)) {
          return buildCompletionResult(request.sessionId, 'no_output_timeout', false, snapshot, state);
        }
      } else {
        if (elapsed >= noOutputTimeoutMs && isStable && idleMs >= settleMs && hasMeaningfulChangeSignal) {
          return buildCompletionResult(request.sessionId, 'idle_stable', true, snapshot, state);
        }

        if (elapsed >= softTimeoutMs && isStable && idleMs >= settleMs && hasMeaningfulChangeSignal) {
          return buildCompletionResult(request.sessionId, 'soft_timeout_stable', true, snapshot, state);
        }

        if (elapsed >= softTimeoutMs && isStable && idleMs >= settleMs && !hasMeaningfulChangeSignal) {
          return buildCompletionResult(request.sessionId, 'no_output_timeout', false, snapshot, state);
        }
      }

      if (hardTimeoutMs !== null && elapsed >= hardTimeoutMs) {
        return buildCompletionResult(request.sessionId, 'hard_timeout_failed', false, snapshot, state);
      }

      await wait(pollIntervalMs);
    }
  }

  async runAutomationTurn(request: TerminalAutomationTurnRequest): Promise<TerminalAutomationTurnResult> {
    this.clearAbort(request.sessionId);
    const beforeSnapshot = request.captureBefore === false ? undefined : await this.captureSnapshot(request.sessionId, 'before-send', true);
    const baselineState = await this.terminalSessionManager.getSessionState(request.sessionId);
    const beforeRawTranscript = await this.terminalSessionManager.getRawTranscriptSince(request.sessionId, 0);
    const baselineRawOffset = beforeRawTranscript.length;

    if (request.kind === 'text') {
      await this.sendInput({
        sessionId: request.sessionId,
        content: request.content ?? '',
        appendEnter: request.appendEnter ?? true,
        source: 'bridge'
      });
    } else {
      const key = request.key ?? 'enter';
      this.terminalSessionManager.sendKey(request.sessionId, key, 'bridge');
    }

    const completion = await this.waitForCompletion({
      sessionId: request.sessionId,
      expectOutput: request.expectOutput ?? request.kind === 'text',
      promoteToOutputOnMeaningfulChange:
        request.kind === 'control' && (request.key ?? 'enter') === 'enter' && !(request.expectOutput ?? false),
      beforeScreenText: beforeSnapshot?.screenText,
      submittedText: request.kind === 'text' ? request.content : undefined,
      submittedTextProbe: request.kind === 'text' ? buildSubmittedTextProbe(request.content) : undefined,
      baselinePromptReadyAt: baselineState.lastPromptReadyAt,
      baselineRawOutputOffset: baselineRawOffset,
      baselineObservedOutputEvents: baselineState.observedOutputEvents
    });

    const afterSnapshot = request.captureAfter === false ? undefined : await this.captureSnapshot(request.sessionId, 'after-complete', true);
    const afterRawTranscript = await this.terminalSessionManager.getRawTranscriptSince(request.sessionId, 0);
    const rawOutput = afterRawTranscript.slice(baselineRawOffset);
    const diffAfterSnapshot = afterSnapshot ?? (await this.captureSnapshot(request.sessionId, 'manual', false));
    const diff = this.diffService.buildDiff({
      beforeSnapshot,
      afterSnapshot: diffAfterSnapshot,
      rawOutput,
      tailChars: this.config.diff.tailChars,
      fallbackLines: this.config.diff.fallbackLines
    });
    const replyResult = sanitizeReplyText({
      beforeText: beforeSnapshot?.screenText,
      afterText: diffAfterSnapshot.screenText,
      fallbackText: diff.source === 'raw-output' ? diffAfterSnapshot.screenText : diff.diffText,
      submittedText: request.kind === 'text' ? request.content : undefined
    });
    const replyText = replyResult.usedFallback
      ? `[reply fallback used]\n${replyResult.text}`
      : replyResult.text;
    const replyChunks = this.replyFormatter.format(replyText, this.preferencesStore.getBridgeSettings().replyFormat);

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
        waitAfterShrinkMs: 500,
        waitAfterRestoreMs: 1000
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

function hasPendingGeminiInput(screenText: string): boolean {
  return extractPendingInputCandidates(screenText).some((candidate) => normalizeComparisonText(candidate).length > 0);
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

function sanitizeReplyText(options: {
  beforeText?: string;
  afterText?: string;
  fallbackText: string;
  submittedText?: string;
}): { text: string; usedFallback: boolean } {
  const extracted = extractSanitizedReplyText(options);
  if (extracted) {
    return {
      text: compressDecorativeRuns(extracted),
      usedFallback: false
    };
  }

  const fallbackText = normalizeTerminalText(options.fallbackText).trim() || '(no diff)';
  return {
    text: compressDecorativeRuns(fallbackText),
    usedFallback: true
  };
}

function hasMeaningfulReplyText(options: {
  beforeText?: string;
  afterText?: string;
  submittedText?: string;
}): boolean {
  return extractSanitizedReplyText({
    beforeText: options.beforeText,
    afterText: options.afterText,
    fallbackText: '',
    submittedText: options.submittedText
  }).length > 0;
}

function extractSanitizedReplyText(options: {
  beforeText?: string;
  afterText?: string;
  fallbackText: string;
  submittedText?: string;
}): string {
  const original = normalizeTerminalText(
    extractTailDiffFromText(options.beforeText, options.afterText) ?? options.fallbackText
  );
  const lines = original.split('\n').map((line) => line.replace(/[ \t]+$/g, ''));
  const normalizedSubmitted = normalizeComparisonText(options.submittedText);
  const submittedLines = splitSubmittedLines(options.submittedText);
  const sanitizedLines = [...lines];
  let submittedLineIndex = 0;

  while (sanitizedLines.length > 0 && !sanitizedLines[0]?.trim()) {
    sanitizedLines.shift();
  }

  while (sanitizedLines.length > 0) {
    const first = sanitizedLines[0] ?? '';
    const withoutPrompt = stripPowerShellPrompt(first);
    if (isPowerShellPromptOnlyLine(first)) {
      sanitizedLines.shift();
      continue;
    }

    const normalizedFirst = normalizeComparisonText(withoutPrompt || first);
    if (submittedLineIndex < submittedLines.length && normalizedFirst === submittedLines[submittedLineIndex]) {
      sanitizedLines.shift();
      submittedLineIndex += 1;
      continue;
    }

    if (normalizedSubmitted && normalizedFirst === normalizedSubmitted) {
      sanitizedLines.shift();
      continue;
    }

    break;
  }

  while (sanitizedLines.length > 0) {
    const last = sanitizedLines[sanitizedLines.length - 1] ?? '';
    if (!last.trim() || isPowerShellPromptOnlyLine(last)) {
      sanitizedLines.pop();
      continue;
    }

    break;
  }

  const withoutPromptLines = sanitizedLines.filter((line) => !isPowerShellPromptOnlyLine(line)).join('\n').trim();
  const inlinePromptStripped = stripInlinePowerShellPrompts(withoutPromptLines);
  const withoutEchoLines = inlinePromptStripped
    .split('\n')
    .map((line) => line.trimEnd())
    .filter((line) => {
      if (!line.trim()) {
        return false;
      }

      return !normalizedSubmitted || normalizeComparisonText(line) !== normalizedSubmitted;
    })
    .join('\n')
    .trim();

  return withoutEchoLines;
}

function splitSubmittedLines(value?: string): string[] {
  return normalizeTerminalText(value ?? '')
    .split('\n')
    .map((line) => normalizeComparisonText(stripPowerShellPrompt(line) || line))
    .filter(Boolean);
}

function stripPowerShellPrompt(line: string): string {
  return line.replace(/^PS [^\r\n>]+>\s*/, '');
}

function isPowerShellPromptOnlyLine(line: string): boolean {
  return /^PS [^\r\n>]+>\s*$/.test(line.trim());
}

function stripInlinePowerShellPrompts(text: string): string {
  return text.replace(/PS [^\r\n>]+>\s*/g, '');
}

function extractTailDiffFromText(beforeText?: string, afterText?: string): string | undefined {
  return extractComparableLineDiff(beforeText, afterText, REPLY_COMPARISON_TAIL_CHARS);
}

function compressDecorativeRuns(text: string): string {
  let result = '';
  let previousCharacter: string | undefined;
  let repeatCount = 0;

  for (const character of text) {
    if (character === previousCharacter) {
      repeatCount += 1;
    } else {
      previousCharacter = character;
      repeatCount = 1;
    }

    if (!shouldCompressRepeatedCharacter(character) || repeatCount <= 5) {
      result += character;
    }
  }

  return result;
}

function shouldCompressRepeatedCharacter(character: string): boolean {
  return character !== '\n' && !isComparableCharacter(character);
}

function wait(durationMs: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, durationMs);
  });
}
const REPLY_COMPARISON_TAIL_CHARS = 20000;
