import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { TerminalSlotId } from '../../shared/terminal';
import { PreferencesStore } from '../app/preferencesStore';
import type { BridgeRuntimeConfig } from './bridgeConfig';

export interface DiscordAttachmentInput {
  id: string;
  url: string;
  name?: string;
  sizeBytes: number;
  contentType?: string;
}

export interface SavedDiscordAttachmentFile {
  index: number;
  attachmentId: string;
  originalName: string;
  savedName: string;
  absolutePath: string;
  sizeBytes: number;
  contentType?: string;
  url: string;
}

export interface SavedDiscordAttachmentBatch {
  slotId: TerminalSlotId;
  channelId: string;
  messageId: string;
  savedAt: string;
  directory: string;
  manifestPath: string;
  count: number;
  totalBytes: number;
  files: SavedDiscordAttachmentFile[];
  contextBlock: string;
}

interface SaveDiscordAttachmentBatchOptions {
  slotId: TerminalSlotId;
  channelId: string;
  messageId: string;
  createdAt: string;
  attachments: DiscordAttachmentInput[];
}

interface AttachmentManifest {
  messageId: string;
  channelId: string;
  slotId: TerminalSlotId;
  savedAt: string;
  directory: string;
  manifestPath: string;
  count: number;
  totalBytes: number;
  files: SavedDiscordAttachmentFile[];
}

export class DiscordAttachmentService {
  constructor(
    private readonly config: BridgeRuntimeConfig,
    private readonly preferencesStore: PreferencesStore
  ) {}

  async saveMessageAttachments(options: SaveDiscordAttachmentBatchOptions): Promise<SavedDiscordAttachmentBatch> {
    validateAttachmentBatch(options.attachments, this.config.attachments.maxFilesPerMessage, this.config.attachments.maxTotalBytes);

    const directory = buildAttachmentDirectory(
      this.config.storage.incomingAttachmentDirectory,
      options.slotId,
      options.createdAt,
      options.messageId
    );
    const savedAt = new Date().toISOString();
    const savedFiles: SavedDiscordAttachmentFile[] = [];
    let totalBytes = 0;

    mkdirSync(directory, { recursive: true });

    try {
      const downloadTimeoutMs = this.preferencesStore.getBridgeSettings().timing.attachmentDownloadTimeoutMs;
      for (const [index, attachment] of options.attachments.entries()) {
        const buffer = await downloadAttachment(attachment.url, downloadTimeoutMs);
        totalBytes += buffer.byteLength;
        if (totalBytes > this.config.attachments.maxTotalBytes) {
          throw new Error(
            `[attachments rejected: max ${this.config.attachments.maxFilesPerMessage} files, ${formatBytes(this.config.attachments.maxTotalBytes)} total]`
          );
        }

        const originalName = normalizeOriginalName(attachment.name, index);
        const savedName = buildSavedFilename(index, originalName);
        const absolutePath = path.join(directory, savedName);
        writeFileSync(absolutePath, buffer);

        savedFiles.push({
          index: index + 1,
          attachmentId: attachment.id,
          originalName,
          savedName,
          absolutePath,
          sizeBytes: buffer.byteLength,
          contentType: attachment.contentType,
          url: attachment.url
        });
      }

      const manifestPath = path.join(directory, 'attachments.json');
      const manifest: AttachmentManifest = {
        messageId: options.messageId,
        channelId: options.channelId,
        slotId: options.slotId,
        savedAt,
        directory,
        manifestPath,
        count: savedFiles.length,
        totalBytes,
        files: savedFiles
      };
      writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf8');

      return {
        slotId: options.slotId,
        channelId: options.channelId,
        messageId: options.messageId,
        savedAt,
        directory,
        manifestPath,
        count: savedFiles.length,
        totalBytes,
        files: savedFiles,
        contextBlock: buildAttachmentContextBlock(directory, manifestPath, savedFiles)
      };
    } catch (error) {
      rmSync(directory, { recursive: true, force: true });
      throw error;
    }
  }
}

function validateAttachmentBatch(attachments: DiscordAttachmentInput[], maxFilesPerMessage: number, maxTotalBytes: number): void {
  if (attachments.length === 0) {
    throw new Error('[attachments rejected: no files found]');
  }

  if (attachments.length > maxFilesPerMessage) {
    throw new Error(`[attachments rejected: max ${maxFilesPerMessage} files per message]`);
  }

  const totalBytes = attachments.reduce((sum, attachment) => sum + Math.max(0, attachment.sizeBytes), 0);
  if (totalBytes > maxTotalBytes) {
    throw new Error(`[attachments rejected: max ${maxFilesPerMessage} files, ${formatBytes(maxTotalBytes)} total]`);
  }
}

function buildAttachmentDirectory(rootDirectory: string, slotId: TerminalSlotId, createdAt: string, messageId: string): string {
  const dateDirectory = createdAt.slice(0, 10);
  return path.join(rootDirectory, `slot-${slotId}`, dateDirectory, `msg-${messageId}`);
}

async function downloadAttachment(url: string, downloadTimeoutMs: number): Promise<Buffer> {
  const response = await fetch(url, {
    signal: AbortSignal.timeout(downloadTimeoutMs)
  });

  if (!response.ok) {
    throw new Error(`[attachments failed: download returned ${response.status} ${response.statusText}]`);
  }

  const data = Buffer.from(await response.arrayBuffer());
  if (data.byteLength === 0) {
    throw new Error('[attachments failed: downloaded file was empty]');
  }

  return data;
}

function buildSavedFilename(index: number, originalName: string): string {
  const safeName = sanitizeFilename(originalName);
  return `${String(index + 1).padStart(3, '0')}-${safeName}`;
}

function normalizeOriginalName(name: string | undefined, index: number): string {
  const trimmed = name?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : `attachment-${index + 1}`;
}

function sanitizeFilename(value: string): string {
  const basename = path.basename(value);
  const replaced = basename
    .replace(/[<>:"/\\|?*\u0000-\u001f]+/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[. ]+$/g, '')
    .slice(0, 120);

  return replaced.length > 0 ? replaced : 'attachment';
}

function buildAttachmentContextBlock(
  directory: string,
  manifestPath: string,
  files: SavedDiscordAttachmentFile[]
): string {
  return [
    '# [DISCORD_ATTACHMENTS_BEGIN]',
    `# directory: ${JSON.stringify(directory)}`,
    `# manifest: ${JSON.stringify(manifestPath)}`,
    `# count: ${files.length}`,
    ...files.map((file) => `# file[${file.index}]: ${JSON.stringify(file.absolutePath)}`),
    '# [DISCORD_ATTACHMENTS_END]'
  ].join('\n');
}

function formatBytes(value: number): string {
  if (value % (1024 * 1024) === 0) {
    return `${value / (1024 * 1024)}MB`;
  }

  return `${value} bytes`;
}
