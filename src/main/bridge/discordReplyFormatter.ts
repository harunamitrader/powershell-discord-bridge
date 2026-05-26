import type { BridgeReplyFormat } from '../../shared/terminal';

interface ReplyFormatterOptions {
  maxMessages: number;
  maxMessageLength: number;
  targetChunkLength: number;
  truncatedNote: string;
}

const CODE_BLOCK_PREFIX = '```text\n';
const CODE_BLOCK_SUFFIX = '\n```';
const MAX_COMPRESSED_SYMBOL_RUN_LENGTH = 5;
const MAX_COMPRESSED_HORIZONTAL_WHITESPACE_RUN_LENGTH = 5;
const MAX_COMPRESSED_LINE_BREAK_RUN_LENGTH = 2;
const REPEATED_SYMBOL_RUN_PATTERN = /([^\p{L}\p{N}\s])\1{4,}/gu;
const REPEATED_HORIZONTAL_WHITESPACE_RUN_PATTERN = /[^\S\r\n]{5,}/g;
const REPEATED_LINE_BREAK_RUN_PATTERN = /\n{3,}/g;

export class DiscordReplyFormatter {
  constructor(private readonly options: ReplyFormatterOptions) {}

  format(diffText: string, replyFormat: BridgeReplyFormat = 'command'): string[] {
    return formatNormalizedReplyText(
      normalizeReplyText(diffText, '(no diff)'),
      replyFormat,
      this.options
    );
  }

  formatVisibleText(screenText: string, maxChars: number, replyFormat: BridgeReplyFormat = 'command'): string[] {
    return formatNormalizedReplyText(
      normalizeReplyText(selectVisibleTextReplyText(screenText, maxChars), '[visible text is empty]'),
      replyFormat,
      this.options
    );
  }
}

function formatNormalizedReplyText(text: string, replyFormat: BridgeReplyFormat, options: ReplyFormatterOptions): string[] {
  const normalized = escapeCodeFences(text);
  const maxChunkPayload = replyFormat === 'command'
    ? Math.max(1, Math.min(options.targetChunkLength, options.maxMessageLength - CODE_BLOCK_PREFIX.length - CODE_BLOCK_SUFFIX.length))
    : Math.max(1, Math.min(options.targetChunkLength, options.maxMessageLength));
  const chunks = chunkText(normalized, maxChunkPayload).map((chunk) => formatChunk(chunk, replyFormat));

  if (chunks.length <= options.maxMessages) {
    return chunks;
  }

  const allowed = chunks.slice(-options.maxMessages);
  const notePrefix = `${options.truncatedNote}\n`;
  const maxFirstPayload = replyFormat === 'command'
    ? options.maxMessageLength - CODE_BLOCK_PREFIX.length - CODE_BLOCK_SUFFIX.length - notePrefix.length
    : options.maxMessageLength - notePrefix.length;
  const firstContent = unwrapChunk(allowed[0], replyFormat);
  const trimmedFirstContent = firstContent.slice(Math.max(0, firstContent.length - Math.max(1, maxFirstPayload)));
  allowed[0] = formatChunk(`${notePrefix}${trimmedFirstContent}`, replyFormat);
  return allowed;
}

function normalizeReplyText(text: string, emptyFallback: string): string {
  const trimmed = compressReplyText(text).trim();
  return trimmed.length > 0 ? trimmed : emptyFallback;
}

function compressReplyText(text: string): string {
  return collapseRepeatedSymbolRuns(collapseRepeatedHorizontalWhitespaceRuns(collapseRepeatedLineBreakRuns(text)));
}

function collapseRepeatedLineBreakRuns(text: string): string {
  return text.replace(REPEATED_LINE_BREAK_RUN_PATTERN, (match) => match.slice(0, MAX_COMPRESSED_LINE_BREAK_RUN_LENGTH));
}

function collapseRepeatedHorizontalWhitespaceRuns(text: string): string {
  return text.replace(REPEATED_HORIZONTAL_WHITESPACE_RUN_PATTERN, (match) => match.slice(0, MAX_COMPRESSED_HORIZONTAL_WHITESPACE_RUN_LENGTH));
}

function collapseRepeatedSymbolRuns(text: string): string {
  return text.replace(REPEATED_SYMBOL_RUN_PATTERN, (_match, symbol: string) => symbol.repeat(MAX_COMPRESSED_SYMBOL_RUN_LENGTH));
}

function selectVisibleTextReplyText(text: string, maxChars: number): string {
  if (maxChars <= 0) {
    return '';
  }

  const compressed = compressReplyText(text).trim();
  if (compressed.length <= maxChars) {
    return compressed;
  }
  return compressed.slice(compressed.length - maxChars);
}

function chunkText(text: string, maxChunkLength: number): string[] {
  const lines = text.split('\n');
  const result: string[] = [];
  let current = '';

  for (const line of lines) {
    const next = current.length === 0 ? line : `${current}\n${line}`;
    if (next.length <= maxChunkLength) {
      current = next;
      continue;
    }

    if (current.length > 0) {
      result.push(current);
      current = '';
    }

    if (line.length <= maxChunkLength) {
      current = line;
      continue;
    }

    for (let index = 0; index < line.length; index += maxChunkLength) {
      result.push(line.slice(index, index + maxChunkLength));
    }
  }

  if (current.length > 0) {
    result.push(current);
  }

  return result.length > 0 ? result : [''];
}

function wrapCodeBlock(text: string): string {
  return `${CODE_BLOCK_PREFIX}${text}${CODE_BLOCK_SUFFIX}`;
}

function unwrapCodeBlock(text: string): string {
  return text.slice(CODE_BLOCK_PREFIX.length, text.length - CODE_BLOCK_SUFFIX.length);
}

function formatChunk(text: string, replyFormat: BridgeReplyFormat): string {
  return replyFormat === 'command' ? wrapCodeBlock(text) : text;
}

function unwrapChunk(text: string, replyFormat: BridgeReplyFormat): string {
  return replyFormat === 'command' ? unwrapCodeBlock(text) : text;
}

function escapeCodeFences(text: string): string {
  return text.replace(/```/g, '``\u200b`');
}
