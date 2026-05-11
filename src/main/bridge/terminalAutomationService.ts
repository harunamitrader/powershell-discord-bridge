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
    const replyText = sanitizeReplyText({
      diffText: diff.diffText,
      rawOutput,
      afterScreenText: afterSnapshot?.screenText,
      submittedText: request.kind === 'text' ? request.content : undefined
    });
    const replyChunks = this.replyFormatter.format(replyText);

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

function sanitizeReplyText(options: {
  diffText: string;
  rawOutput: string;
  afterScreenText?: string;
  submittedText?: string;
}): string {
  const submittedText = options.submittedText;
  const profile = detectReplyProfile(submittedText, options.afterScreenText);
  const profileReply = extractProfileReply(profile, options.rawOutput, options.afterScreenText, submittedText);
  const original = normalizeTerminalText(profileReply ?? options.diffText);
  const lines = original.split('\n').map((line) => line.replace(/[ \t]+$/g, ''));
  const normalizedSubmitted = normalizeComparisonText(submittedText);
  const sanitizedLines = [...lines];

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

    if (normalizedSubmitted && normalizeComparisonText(withoutPrompt || first) === normalizedSubmitted) {
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
  const cleaned = dedupeRepeatedLineBlocks(dedupeAdjacentDuplicateLines(withoutEchoLines));

  return cleaned || original.trim() || '(no diff)';
}

type ReplyProfile = 'generic' | 'gemini-print' | 'gemini-interactive' | 'codex-exec' | 'claude-print' | 'copilot-print';

function stripPowerShellPrompt(line: string): string {
  return line.replace(/^PS [^\r\n>]+>\s*/, '');
}

function isPowerShellPromptOnlyLine(line: string): boolean {
  return /^PS [^\r\n>]+>\s*$/.test(line.trim());
}

function stripInlinePowerShellPrompts(text: string): string {
  return text.replace(/PS [^\r\n>]+>\s*/g, '');
}

function normalizeTerminalText(text: string): string {
  return text
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/\u001b\][\s\S]*?(?:\u0007|\u001b\\)/g, '')
    .replace(/\u001b\[[0-9;?]*[ -/]*[@-~]/g, '')
    .replace(/\u001b[@-_]/g, '')
    .replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, '')
    .replace(/[ \t]+$/gm, '');
}

function detectReplyProfile(submittedText: string | undefined, afterScreenText?: string): ReplyProfile {
  const submittedLower = submittedText?.trim().toLowerCase() ?? '';
  const normalizedAfter = normalizeTerminalText(afterScreenText ?? '');
  if (normalizedAfter.includes('Type your message or @path/to/file')) {
    return 'gemini-interactive';
  }

  if (/^gemini\b/.test(submittedLower) && /\s(?:-p|--prompt)\b/.test(submittedLower)) {
    return 'gemini-print';
  }

  if (/^codex\s+exec\b/.test(submittedLower)) {
    return 'codex-exec';
  }

  if (/^claude\b/.test(submittedLower) && /\s(?:-p|--print)\b/.test(submittedLower)) {
    return 'claude-print';
  }

  if (/^copilot\b/.test(submittedLower) && /\s(?:-p|--prompt)\b/.test(submittedLower)) {
    return 'copilot-print';
  }

  return 'generic';
}

function extractProfileReply(
  profile: ReplyProfile,
  rawOutput: string,
  afterScreenText: string | undefined,
  submittedText: string | undefined
): string | undefined {
  switch (profile) {
    case 'gemini-interactive':
      return extractGeminiInteractiveReply(afterScreenText ?? '');
    case 'gemini-print':
      return extractGeminiPrintReply(normalizeTerminalText(rawOutput), submittedText);
    case 'codex-exec':
      return extractCodexExecReply(normalizeTerminalText(rawOutput), submittedText);
    case 'claude-print':
    case 'copilot-print':
      return extractTrailingBlock(normalizeTerminalText(rawOutput), submittedText);
    default:
      return undefined;
  }
}

function extractGeminiInteractiveReply(screenText: string): string | undefined {
  const lines = normalizeTerminalText(screenText).split('\n').map((line) => line.trimEnd());
  let assistantLineIndex = -1;
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    if (lines[index].trimStart().startsWith('✦ ')) {
      assistantLineIndex = index;
      break;
    }
  }

  if (assistantLineIndex === -1) {
    return undefined;
  }

  const replyLines: string[] = [lines[assistantLineIndex].replace(/^.*?✦\s*/, '').trimEnd()];
  for (let index = assistantLineIndex + 1; index < lines.length; index += 1) {
    const line = lines[index];
    if (isGeminiUiFooterLine(line)) {
      break;
    }

    replyLines.push(line);
  }

  return replyLines.join('\n').trim();
}

function extractGeminiPrintReply(rawOutput: string, submittedText: string | undefined): string | undefined {
  const lines = rawOutput.split('\n').map((line) => line.trimEnd());
  let lastNoiseIndex = -1;
  for (let index = 0; index < lines.length; index += 1) {
    const trimmed = lines[index].trimStart();
    if (GEMINI_NOISE_PREFIXES.some((prefix) => trimmed.startsWith(prefix))) {
      lastNoiseIndex = index;
    }
  }

  const replyLines = lines
    .slice(lastNoiseIndex + 1)
    .filter((line) => {
      const trimmed = line.trim();
      if (!trimmed) {
        return false;
      }

      if (trimmed === submittedText?.trim()) {
        return false;
      }

      return !isPowerShellPromptOnlyLine(trimmed);
    });

  if (replyLines.length > 0) {
    return replyLines.join('\n').trim();
  }

  return extractTrailingBlock(stripKnownNoise(rawOutput, GEMINI_NOISE_PREFIXES), submittedText);
}

function isGeminiUiFooterLine(line: string): boolean {
  const trimmed = line.trim();
  return (
    trimmed.length === 0 ||
    trimmed.startsWith('? for shortcuts') ||
    trimmed.startsWith('auto-accept edits ') ||
    trimmed.startsWith('>') ||
    trimmed.startsWith('workspace ') ||
    trimmed.startsWith('~\\') ||
    /^[-─]{8,}$/.test(trimmed) ||
    /^[▀▄]{8,}$/.test(trimmed)
  );
}

function extractCodexExecReply(rawOutput: string, submittedText: string | undefined): string | undefined {
  const lines = rawOutput.split('\n').map((line) => line.trimEnd());
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    if (lines[index].trim() !== 'codex') {
      continue;
    }

    const replyLines: string[] = [];
    for (let nextIndex = index + 1; nextIndex < lines.length; nextIndex += 1) {
      const line = lines[nextIndex];
      const trimmed = line.trim();
      if (!trimmed || trimmed === submittedText?.trim() || trimmed === 'tokens used' || isPowerShellPromptOnlyLine(trimmed)) {
        break;
      }

      replyLines.push(line);
    }

    if (replyLines.length > 0) {
      return replyLines.join('\n').trim();
    }
  }

  return extractTrailingBlock(stripKnownNoise(rawOutput, CODEX_NOISE_PREFIXES), submittedText);
}

function stripKnownNoise(text: string, prefixes: readonly string[]): string {
  return text
    .split('\n')
    .filter((line) => {
      const trimmed = line.trimStart();
      return !prefixes.some((prefix) => trimmed.startsWith(prefix));
    })
    .join('\n');
}

function extractTrailingBlock(text: string, submittedText: string | undefined): string | undefined {
  const filteredLines = text
    .split('\n')
    .map((line) => line.trimEnd())
    .filter((line) => {
      const trimmed = line.trim();
      if (!trimmed) {
        return true;
      }

      if (trimmed === submittedText?.trim()) {
        return false;
      }

      return !isPowerShellPromptOnlyLine(trimmed);
    });
  const blocks = filteredLines
    .join('\n')
    .split(/\n\s*\n+/)
    .map((block) => block.trim())
    .filter((block) => block.length > 0);

  return blocks.at(-1);
}

function dedupeAdjacentDuplicateLines(text: string): string {
  const result: string[] = [];
  for (const line of text.split('\n')) {
    if (result.length === 0 || result[result.length - 1] !== line) {
      result.push(line);
    }
  }

  return result.join('\n');
}

function dedupeRepeatedLineBlocks(text: string): string {
  if (!text) {
    return text;
  }

  const lines = text.split('\n');
  for (let parts = 4; parts >= 2; parts -= 1) {
    if (lines.length % parts !== 0) {
      continue;
    }

    const chunkLength = lines.length / parts;
    const firstChunk = lines.slice(0, chunkLength).join('\n');
    let allEqual = true;
    for (let index = 1; index < parts; index += 1) {
      const chunk = lines.slice(index * chunkLength, (index + 1) * chunkLength).join('\n');
      if (chunk !== firstChunk) {
        allEqual = false;
        break;
      }
    }

    if (allEqual) {
      return firstChunk;
    }
  }

  return text;
}

const GEMINI_NOISE_PREFIXES = [
  'Loaded cached credentials.',
  '[MCP error]',
  'at ',
  'code:',
  'data:',
  'MCP issues detected.',
  'Registering notification handlers',
  "Server '",
  'Scheduling MCP context refresh...',
  'Executing MCP context refresh...',
  'MCP context refresh complete.'
] as const;

const CODEX_NOISE_PREFIXES = [
  'OpenAI Codex',
  '--------',
  'workdir:',
  'model:',
  'provider:',
  'approval:',
  'sandbox:',
  'reasoning effort:',
  'reasoning summaries:',
  'session id:',
  'user',
  'tokens used'
] as const;

function wait(durationMs: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, durationMs);
  });
}
