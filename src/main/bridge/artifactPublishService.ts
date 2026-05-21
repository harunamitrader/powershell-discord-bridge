import { createHash } from 'node:crypto';
import { mkdirSync, readdirSync, readFileSync, statSync, type Dirent } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import chokidar, { type FSWatcher } from 'chokidar';
import { PreferencesStore } from '../app/preferencesStore';
import { TerminalSlotService } from '../app/terminalSlotService';
import { DiscordBridgeService } from './discordBridgeService';

const WATCH_DEBOUNCE_MS = 800;
const FILE_STABILITY_WAIT_MS = 300;
const MAX_ARTIFACT_FILE_BYTES = 10 * 1024 * 1024;

export class ArtifactPublishService {
  private watcher?: FSWatcher;
  private watchRoot?: string;
  private readonly pendingTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly publishedSignatures = new Map<string, string>();

  constructor(
    private readonly preferencesStore: PreferencesStore,
    private readonly terminalSlotService: TerminalSlotService,
    private readonly discordBridgeService: DiscordBridgeService
  ) {}

  initializeDefaults(): void {
    const slotOneCwd = this.terminalSlotService.getSlot(1).cwd;
    this.preferencesStore.ensureArtifactPublishDefaults(slotOneCwd);
  }

  start(): void {
    this.restartWatcher();
  }

  refreshFromSettings(): void {
    this.restartWatcher();
  }

  stop(): void {
    this.watcher?.close();
    this.watcher = undefined;
    this.watchRoot = undefined;
    for (const timer of this.pendingTimers.values()) {
      clearTimeout(timer);
    }
    this.pendingTimers.clear();
    this.publishedSignatures.clear();
  }

  private restartWatcher(): void {
    this.stop();

    const watchDirectory = this.preferencesStore.getBridgeSettings().artifactPublish.watchDirectory;
    if (!watchDirectory) {
      console.warn('Artifact publish watcher is disabled because no watch directory is configured.');
      return;
    }

    mkdirSync(watchDirectory, { recursive: true });
    this.watchRoot = watchDirectory;
    this.seedPublishedSignatures(watchDirectory);
    this.watcher = chokidar.watch(watchDirectory, {
      ignoreInitial: true,
      awaitWriteFinish: {
        stabilityThreshold: FILE_STABILITY_WAIT_MS,
        pollInterval: 100
      }
    });
    this.watcher.on('add', (filePath) => {
      this.queueCandidate(filePath);
    });
    this.watcher.on('change', (filePath) => {
      this.queueCandidate(filePath);
    });
    this.watcher.on('unlink', (filePath) => {
      this.clearPublishedSignature(filePath);
    });
    console.info(`Watching artifact publish folder: ${watchDirectory}`);
  }

  private queueCandidate(candidatePath: string | null, delayMs = WATCH_DEBOUNCE_MS): void {
    if (!this.watchRoot || !candidatePath) {
      return;
    }

    const normalizedPath = candidatePath.trim();
    if (!normalizedPath) {
      return;
    }

    const fullPath = path.isAbsolute(normalizedPath) ? path.resolve(normalizedPath) : path.resolve(this.watchRoot, normalizedPath);
    if (!isDescendantPath(fullPath, this.watchRoot)) {
      return;
    }

    const dedupeKey = fullPath.toLowerCase();
    const existingTimer = this.pendingTimers.get(dedupeKey);
    if (existingTimer) {
      clearTimeout(existingTimer);
    }

    const timer = setTimeout(() => {
      this.pendingTimers.delete(dedupeKey);
      void this.processCandidate(fullPath).catch((error) => {
        console.error(`Artifact publish failed for ${fullPath}`, error);
      });
    }, delayMs);
    this.pendingTimers.set(dedupeKey, timer);
  }

  private clearPublishedSignature(candidatePath: string): void {
    if (!this.watchRoot) {
      return;
    }

    const fullPath = path.isAbsolute(candidatePath) ? path.resolve(candidatePath) : path.resolve(this.watchRoot, candidatePath);
    if (!isDescendantPath(fullPath, this.watchRoot)) {
      return;
    }

    const dedupeKey = fullPath.toLowerCase();
    const existingTimer = this.pendingTimers.get(dedupeKey);
    if (existingTimer) {
      clearTimeout(existingTimer);
      this.pendingTimers.delete(dedupeKey);
    }
    this.publishedSignatures.delete(dedupeKey);
  }

  private seedPublishedSignatures(rootPath: string): void {
    for (const fullPath of listArtifactFiles(rootPath)) {
      if (shouldIgnoreArtifactPath(fullPath)) {
        continue;
      }

      try {
        const fileInfo = statSync(fullPath);
        if (!fileInfo.isFile() || fileInfo.size <= 0) {
          continue;
        }

        const dedupeKey = fullPath.toLowerCase();
        if (fileInfo.size > MAX_ARTIFACT_FILE_BYTES) {
          this.publishedSignatures.set(dedupeKey, `oversize:${fileInfo.size}:${fileInfo.mtimeMs}`);
          continue;
        }

        const signature = createHash('sha256').update(readFileSync(fullPath)).digest('hex');
        this.publishedSignatures.set(dedupeKey, signature);
      } catch (error) {
        if (isMissingFileError(error) || isTransientFileError(error)) {
          continue;
        }
        console.warn(`Artifact publish baseline skipped for ${fullPath}`, error);
      }
    }
  }

  private async processCandidate(fullPath: string): Promise<void> {
    if (!this.watchRoot || shouldIgnoreArtifactPath(fullPath)) {
      return;
    }

    const fileInfo = await this.getStableFileInfo(fullPath);
    if (!fileInfo) {
      return;
    }

    const relativePath = path.relative(this.watchRoot, fullPath);
    if (!relativePath || relativePath.startsWith('..')) {
      return;
    }

    const dedupeKey = fullPath.toLowerCase();
    if (fileInfo.sizeBytes > MAX_ARTIFACT_FILE_BYTES) {
      const signature = `oversize:${fileInfo.sizeBytes}:${fileInfo.modifiedAtMs}`;
      if (this.publishedSignatures.get(dedupeKey) === signature) {
        return;
      }

      await this.discordBridgeService.publishArtifactError({
        watchDirectory: this.watchRoot,
        fullPath,
        relativePath,
        sizeBytes: fileInfo.sizeBytes,
        reason: 'file-too-large'
      });
      this.publishedSignatures.set(dedupeKey, signature);
      return;
    }

    let buffer: Buffer;
    try {
      buffer = await readFile(fullPath);
    } catch (error) {
      if (isTransientFileError(error)) {
        this.queueCandidate(path.relative(this.watchRoot, fullPath), FILE_STABILITY_WAIT_MS);
        return;
      }
      throw error;
    }

    const signature = createHash('sha256').update(buffer).digest('hex');
    if (this.publishedSignatures.get(dedupeKey) === signature) {
      return;
    }

    try {
      await this.discordBridgeService.publishArtifactFile({
        watchDirectory: this.watchRoot,
        fullPath,
        relativePath,
        sizeBytes: buffer.length,
        buffer
      });
      this.publishedSignatures.set(dedupeKey, signature);
    } catch (error) {
      if (!looksLikeDiscordFileTooLargeError(error)) {
        throw error;
      }

      const oversizeSignature = `oversize:${buffer.length}:${signature}`;
      if (this.publishedSignatures.get(dedupeKey) === oversizeSignature) {
        return;
      }

      await this.discordBridgeService.publishArtifactError({
        watchDirectory: this.watchRoot,
        fullPath,
        relativePath,
        sizeBytes: buffer.length,
        reason: 'file-too-large'
      });
      this.publishedSignatures.set(dedupeKey, oversizeSignature);
    }
  }

  private async getStableFileInfo(fullPath: string): Promise<{ sizeBytes: number; modifiedAtMs: number } | undefined> {
    const first = await safeFileStat(fullPath);
    if (!first || !first.isFile() || first.size <= 0) {
      return undefined;
    }

    await wait(FILE_STABILITY_WAIT_MS);

    const second = await safeFileStat(fullPath);
    if (!second || !second.isFile() || second.size <= 0) {
      return undefined;
    }

    if (first.size !== second.size || first.mtimeMs !== second.mtimeMs) {
      this.queueCandidate(path.relative(this.watchRoot ?? path.dirname(fullPath), fullPath), FILE_STABILITY_WAIT_MS);
      return undefined;
    }

    return {
      sizeBytes: second.size,
      modifiedAtMs: second.mtimeMs
    };
  }
}

async function safeFileStat(fullPath: string) {
  try {
    return await stat(fullPath);
  } catch (error) {
    if (isMissingFileError(error) || isTransientFileError(error)) {
      return undefined;
    }
    throw error;
  }
}

function shouldIgnoreArtifactPath(fullPath: string): boolean {
  const baseName = path.basename(fullPath);
  if (!baseName) {
    return true;
  }

  return baseName.startsWith('~$') || /\.(tmp|crdownload|part)$/i.test(baseName);
}

function isDescendantPath(candidatePath: string, rootPath: string): boolean {
  const relative = path.relative(rootPath, candidatePath);
  return relative.length > 0 && !relative.startsWith('..') && !path.isAbsolute(relative);
}

function isMissingFileError(error: unknown): boolean {
  return isNodeErrorWithCode(error, 'ENOENT');
}

function isTransientFileError(error: unknown): boolean {
  return isNodeErrorWithCode(error, 'EBUSY') || isNodeErrorWithCode(error, 'EPERM');
}

function isNodeErrorWithCode(error: unknown, code: string): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && (error as { code?: unknown }).code === code;
}

function looksLikeDiscordFileTooLargeError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  return /file.+too large|request entity too large|payload too large|maximum.+file size/i.test(error.message);
}

function listArtifactFiles(rootPath: string): string[] {
  const files: string[] = [];
  const stack = [rootPath];

  while (stack.length > 0) {
    const currentPath = stack.pop();
    if (!currentPath) {
      continue;
    }

    let entries: Dirent<string>[];
    try {
      entries = readdirSync(currentPath, { withFileTypes: true, encoding: 'utf8' });
    } catch (error) {
      if (isMissingFileError(error) || isTransientFileError(error)) {
        continue;
      }
      throw error;
    }

    for (const entry of entries) {
      const entryPath = path.join(currentPath, entry.name);
      if (entry.isDirectory()) {
        stack.push(entryPath);
      } else if (entry.isFile()) {
        files.push(entryPath);
      }
    }
  }

  return files;
}

function wait(durationMs: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, durationMs);
  });
}
