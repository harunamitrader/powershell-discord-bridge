import type { TerminalDiffResult, TerminalSessionSnapshot } from '../../shared/terminal';
import { extractComparableLineDiff, normalizeTerminalText, toComparableText } from './replyTextDiff';

interface BuildDiffOptions {
  beforeSnapshot?: TerminalSessionSnapshot;
  afterSnapshot: TerminalSessionSnapshot;
  rawOutput: string;
  tailChars: number;
  fallbackLines: number;
  middleAnchorChars: number;
}

export class TerminalDiffService {
  buildDiff(options: BuildDiffOptions): TerminalDiffResult {
    const normalizedRawOutput = normalizeTerminalText(options.rawOutput);
    const screenDiff = extractComparableLineDiff(
      options.beforeSnapshot?.screenText ?? '',
      options.afterSnapshot.screenText,
      options.tailChars,
      options.middleAnchorChars
    ) ?? '';

    if (shouldPreferScreenDiff(normalizedRawOutput, screenDiff, options.afterSnapshot.screenText)) {
      return {
        beforeSnapshotId: options.beforeSnapshot?.snapshotId,
        afterSnapshotId: options.afterSnapshot.snapshotId,
        diffText: screenDiff,
        diffLineCount: countLines(screenDiff),
        wasFallbackUsed: false,
        source: 'screen-diff'
      };
    }

    if (normalizedRawOutput.trim().length > 0) {
      return {
        beforeSnapshotId: options.beforeSnapshot?.snapshotId,
        afterSnapshotId: options.afterSnapshot.snapshotId,
        diffText: normalizedRawOutput,
        diffLineCount: countLines(normalizedRawOutput),
        wasFallbackUsed: false,
        source: 'raw-output'
      };
    }

    if (screenDiff.trim().length > 0) {
      return {
        beforeSnapshotId: options.beforeSnapshot?.snapshotId,
        afterSnapshotId: options.afterSnapshot.snapshotId,
        diffText: screenDiff,
        diffLineCount: countLines(screenDiff),
        wasFallbackUsed: false,
        source: 'screen-diff'
      };
    }

    const afterTail = tailLines(normalizeTerminalText(options.afterSnapshot.screenText), options.fallbackLines);
    return {
      beforeSnapshotId: options.beforeSnapshot?.snapshotId,
      afterSnapshotId: options.afterSnapshot.snapshotId,
      diffText: afterTail,
      diffLineCount: countLines(afterTail),
      wasFallbackUsed: true,
      source: 'after-tail'
    };
  }
}

function tailLines(text: string, count: number): string {
  const lines = text.split('\n');
  return lines.slice(Math.max(0, lines.length - count)).join('\n');
}

function countLines(text: string): number {
  if (!text) {
    return 0;
  }

  return text.split('\n').length;
}

function shouldPreferScreenDiff(rawOutput: string, screenDiff: string, afterScreenText: string): boolean {
  if (rawOutput.trim().length === 0 || screenDiff.trim().length === 0) {
    return false;
  }

  const comparableRaw = collapseComparisonText(rawOutput);
  const comparableDiff = collapseComparisonText(screenDiff);
  const comparableAfterScreen = collapseComparisonText(normalizeTerminalText(afterScreenText));
  if (!comparableRaw || !comparableDiff || !comparableAfterScreen) {
    return false;
  }

  if (!comparableRaw.includes(comparableDiff) || !comparableRaw.includes(comparableAfterScreen)) {
    return false;
  }

  const remainderLength = comparableRaw.length - comparableAfterScreen.length;
  const maxAllowedRemainder = Math.max(120, Math.floor(comparableAfterScreen.length * 0.35));
  if (remainderLength <= maxAllowedRemainder) {
    return true;
  }

  const rawMeaningfulLines = countMeaningfulLines(rawOutput);
  const diffMeaningfulLines = countMeaningfulLines(screenDiff);
  if (diffMeaningfulLines === 0) {
    return false;
  }

  return rawMeaningfulLines <= diffMeaningfulLines * 2 && rawOutput.length > screenDiff.length;
}

function collapseComparisonText(text: string): string {
  return toComparableText(text);
}

function countMeaningfulLines(text: string): number {
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0).length;
}
