interface ComparableStream {
  text: string;
  lineIndexByCharacter: number[];
}

const ANSI_OSC_PATTERN = /\u001b\][\s\S]*?(?:\u0007|\u001b\\)/g;
const ANSI_CSI_PATTERN = /\u001b\[[0-9;?]*[ -/]*[@-~]/g;
const ANSI_ESCAPE_PATTERN = /\u001b[@-_]/g;
const CONTROL_CHARACTER_PATTERN = /[\u0000-\u0008\u000b-\u001f\u007f]/g;
const COMPARABLE_CHARACTER_PATTERN = /[\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Han}\p{Script=Latin}\p{Number}]/u;

export function normalizeTerminalText(text: string): string {
  return text
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(ANSI_OSC_PATTERN, '')
    .replace(ANSI_CSI_PATTERN, '')
    .replace(ANSI_ESCAPE_PATTERN, '')
    .replace(CONTROL_CHARACTER_PATTERN, '')
    .replace(/[ \t]+$/gm, '');
}

export function extractComparableLineDiff(
  beforeText: string | undefined,
  afterText: string | undefined,
  maxComparableChars: number,
  middleAnchorChars: number
): string | undefined {
  const normalizedAfter = normalizeTerminalText(afterText ?? '');
  if (!normalizedAfter) {
    return undefined;
  }

  const afterLines = normalizedAfter.split('\n');
  const afterComparable = tailComparableStream(buildComparableStream(afterLines), maxComparableChars);
  if (afterComparable.text.length === 0) {
    return '';
  }

  const normalizedBefore = normalizeTerminalText(beforeText ?? '');
  if (!normalizedBefore) {
    return sliceLineRange(afterLines, afterComparable, 0, afterComparable.text.length - 1);
  }

  const beforeComparable = tailComparableStream(buildComparableStream(normalizedBefore.split('\n')), maxComparableChars);
  const diffRange = findComparableDiffRange(beforeComparable.text, afterComparable.text);
  if (!diffRange) {
    return '';
  }

  const anchoredStartIndex = findMiddleAnchorStartIndex(beforeComparable.text, afterComparable.text, diffRange, middleAnchorChars);
  return sliceLineRange(afterLines, afterComparable, anchoredStartIndex, diffRange.endIndex);
}

export function toComparableText(text: string): string {
  let result = '';
  for (const character of normalizeTerminalText(text).normalize('NFKC')) {
    if (isComparableCharacter(character)) {
      result += character;
    }
  }

  return result;
}

export function isComparableCharacter(character: string): boolean {
  return COMPARABLE_CHARACTER_PATTERN.test(character);
}

function buildComparableStream(lines: string[]): ComparableStream {
  const characters: string[] = [];
  const lineIndexByCharacter: number[] = [];

  lines.forEach((line, lineIndex) => {
    const normalizedLine = line.normalize('NFKC');
    for (const character of normalizedLine) {
      if (!isComparableCharacter(character)) {
        continue;
      }

      characters.push(character);
      lineIndexByCharacter.push(lineIndex);
    }
  });

  return {
    text: characters.join(''),
    lineIndexByCharacter
  };
}

function tailComparableStream(stream: ComparableStream, maxChars: number): ComparableStream {
  if (stream.text.length <= maxChars) {
    return stream;
  }

  const startIndex = Math.max(0, stream.text.length - maxChars);
  return {
    text: stream.text.slice(startIndex),
    lineIndexByCharacter: stream.lineIndexByCharacter.slice(startIndex)
  };
}

function findComparableDiffRange(beforeText: string, afterText: string): { startIndex: number; endIndex: number } | null {
  let prefixLength = 0;
  while (
    prefixLength < beforeText.length &&
    prefixLength < afterText.length &&
    beforeText[prefixLength] === afterText[prefixLength]
  ) {
    prefixLength += 1;
  }

  let beforeSuffixIndex = beforeText.length - 1;
  let afterSuffixIndex = afterText.length - 1;
  while (
    beforeSuffixIndex >= prefixLength &&
    afterSuffixIndex >= prefixLength &&
    beforeText[beforeSuffixIndex] === afterText[afterSuffixIndex]
  ) {
    beforeSuffixIndex -= 1;
    afterSuffixIndex -= 1;
  }

  if (afterSuffixIndex < prefixLength) {
    return null;
  }

  return {
    startIndex: prefixLength,
    endIndex: afterSuffixIndex
  };
}

function findMiddleAnchorStartIndex(
  beforeText: string,
  afterText: string,
  diffRange: { startIndex: number; endIndex: number },
  middleAnchorChars: number
): number {
  const latestAnchorEndIndex = findLatestUniqueAnchorEndIndex(beforeText, afterText, diffRange, middleAnchorChars);
  if (latestAnchorEndIndex === null || latestAnchorEndIndex <= diffRange.startIndex) {
    return diffRange.startIndex;
  }

  return latestAnchorEndIndex;
}

function findLatestUniqueAnchorEndIndex(
  beforeText: string,
  afterText: string,
  diffRange: { startIndex: number; endIndex: number },
  anchorLength: number
): number | null {
  if (anchorLength <= 0 || beforeText.length < anchorLength || afterText.length < anchorLength) {
    return null;
  }

  const latestAnchorStart = diffRange.endIndex - anchorLength + 1;
  if (latestAnchorStart < diffRange.startIndex) {
    return null;
  }

  const beforeWindowCounts = buildWindowCounts(beforeText, anchorLength);
  const afterWindowCounts = buildWindowCounts(afterText, anchorLength);
  for (let anchorStart = latestAnchorStart; anchorStart >= diffRange.startIndex; anchorStart -= 1) {
    const candidate = afterText.slice(anchorStart, anchorStart + anchorLength);
    const beforeCount = beforeWindowCounts.get(candidate) ?? 0;
    const afterCount = afterWindowCounts.get(candidate) ?? 0;
    if (beforeCount === 1 && afterCount === 1) {
      return anchorStart + anchorLength;
    }
  }

  return null;
}

function buildWindowCounts(text: string, windowLength: number): Map<string, number> {
  const counts = new Map<string, number>();
  for (let index = 0; index <= text.length - windowLength; index += 1) {
    const key = text.slice(index, index + windowLength);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }

  return counts;
}

function sliceLineRange(lines: string[], stream: ComparableStream, startIndex: number, endIndex: number): string {
  if (startIndex > endIndex) {
    return '';
  }

  const startLineIndex = stream.lineIndexByCharacter[startIndex];
  const endLineIndex = stream.lineIndexByCharacter[endIndex];
  if (startLineIndex === undefined || endLineIndex === undefined) {
    return '';
  }

  return lines.slice(startLineIndex, endLineIndex + 1).join('\n');
}
