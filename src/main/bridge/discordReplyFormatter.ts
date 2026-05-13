import type { BridgeReplyFormat } from '../../shared/terminal';

interface ReplyFormatterOptions {
  maxMessages: number;
  maxMessageLength: number;
  targetChunkLength: number;
  truncatedNote: string;
}

const CODE_BLOCK_PREFIX = '```text\n';
const CODE_BLOCK_SUFFIX = '\n```';

export class DiscordReplyFormatter {
  constructor(private readonly options: ReplyFormatterOptions) {}

  format(diffText: string, replyFormat: BridgeReplyFormat = 'command'): string[] {
    const normalized = escapeCodeFences(diffText.trim().length > 0 ? diffText : '(no diff)');
    const maxChunkPayload = replyFormat === 'command'
      ? Math.max(1, Math.min(this.options.targetChunkLength, this.options.maxMessageLength - CODE_BLOCK_PREFIX.length - CODE_BLOCK_SUFFIX.length))
      : Math.max(1, Math.min(this.options.targetChunkLength, this.options.maxMessageLength));
    const chunks = chunkText(normalized, maxChunkPayload).map((chunk) => formatChunk(chunk, replyFormat));

    if (chunks.length <= this.options.maxMessages) {
      return chunks;
    }

    const allowed = chunks.slice(-this.options.maxMessages);
    const notePrefix = `${this.options.truncatedNote}\n`;
    const maxFirstPayload = replyFormat === 'command'
      ? this.options.maxMessageLength - CODE_BLOCK_PREFIX.length - CODE_BLOCK_SUFFIX.length - notePrefix.length
      : this.options.maxMessageLength - notePrefix.length;
    const firstContent = unwrapChunk(allowed[0], replyFormat);
    const trimmedFirstContent = firstContent.slice(Math.max(0, firstContent.length - Math.max(1, maxFirstPayload)));
    allowed[0] = formatChunk(`${notePrefix}${trimmedFirstContent}`, replyFormat);
    return allowed;
  }
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
