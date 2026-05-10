import type { TerminalDiffResult, TerminalSessionSnapshot } from '../../shared/terminal';

interface BuildDiffOptions {
  beforeSnapshot?: TerminalSessionSnapshot;
  afterSnapshot: TerminalSessionSnapshot;
  rawOutput: string;
  tailChars: number;
  fallbackLines: number;
}

const ANSI_PATTERN = /\u001b\[[0-9;?]*[ -/]*[@-~]/g;

export class TerminalDiffService {
  buildDiff(options: BuildDiffOptions): TerminalDiffResult {
    const normalizedRawOutput = normalizeText(options.rawOutput);
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

    const screenDiff = buildScreenDiff(options.beforeSnapshot?.screenText ?? '', options.afterSnapshot.screenText, options.tailChars);
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

    const afterTail = tailLines(normalizeText(options.afterSnapshot.screenText), options.fallbackLines);
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

function buildScreenDiff(beforeText: string, afterText: string, tailChars: number): string {
  const beforeTail = normalizeText(sliceTail(beforeText, tailChars));
  const afterTail = normalizeText(sliceTail(afterText, tailChars));
  if (afterTail.length === 0) {
    return '';
  }

  let prefixLength = 0;
  while (
    prefixLength < beforeTail.length &&
    prefixLength < afterTail.length &&
    beforeTail[prefixLength] === afterTail[prefixLength]
  ) {
    prefixLength += 1;
  }

  let beforeSuffixIndex = beforeTail.length - 1;
  let afterSuffixIndex = afterTail.length - 1;
  while (beforeSuffixIndex >= prefixLength && afterSuffixIndex >= prefixLength && beforeTail[beforeSuffixIndex] === afterTail[afterSuffixIndex]) {
    beforeSuffixIndex -= 1;
    afterSuffixIndex -= 1;
  }

  return afterTail.slice(prefixLength, afterSuffixIndex + 1);
}

function normalizeText(text: string): string {
  return text.replace(/\r\n/g, '\n').replace(ANSI_PATTERN, '').replace(/[ \t]+$/gm, '');
}

function sliceTail(text: string, tailChars: number): string {
  if (text.length <= tailChars) {
    return text;
  }

  return text.slice(text.length - tailChars);
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
