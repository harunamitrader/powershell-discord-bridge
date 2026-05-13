import type { AppLogEntry, AppLogStream } from '../../shared/terminal';

const MAX_LOG_ENTRIES = 2000;
const MAX_LOG_CHARACTERS = 200000;
const ANSI_ESCAPE_PATTERN = /\u001b\[[0-9;?]*[ -/]*[@-~]/g;

type AppLogListener = (entry: AppLogEntry) => void;

export class AppLogStore {
  private readonly entries: AppLogEntry[] = [];
  private readonly listeners = new Set<AppLogListener>();
  private installed = false;
  private nextId = 1;
  private totalCharacters = 0;

  listEntries(): AppLogEntry[] {
    return [...this.entries];
  }

  onEntry(listener: AppLogListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  appendMessage(stream: AppLogStream, text: string): void {
    this.append(stream, normalizeChunk(text));
  }

  installProcessCapture(): void {
    if (this.installed) {
      return;
    }

    this.installed = true;
    this.wrapStream(process.stdout, 'stdout');
    this.wrapStream(process.stderr, 'stderr');
  }

  private wrapStream(stream: NodeJS.WriteStream, target: AppLogStream): void {
    const originalWrite = stream.write.bind(stream);
    const store = this;

    stream.write = function patchedWrite(chunk: unknown, encoding?: unknown, callback?: unknown): boolean {
      store.append(target, normalizeChunk(chunk, encoding));
      return originalWrite(chunk as never, encoding as never, callback as never);
    };
  }

  private append(stream: AppLogStream, text: string): void {
    if (text.length === 0) {
      return;
    }

    const entry: AppLogEntry = {
      id: this.nextId++,
      timestamp: new Date().toISOString(),
      stream,
      text
    };

    this.entries.push(entry);
    this.totalCharacters += entry.text.length;
    this.trim();

    for (const listener of this.listeners) {
      listener(entry);
    }
  }

  private trim(): void {
    while (this.entries.length > MAX_LOG_ENTRIES || this.totalCharacters > MAX_LOG_CHARACTERS) {
      const removed = this.entries.shift();
      if (!removed) {
        return;
      }

      this.totalCharacters -= removed.text.length;
    }
  }
}

function normalizeChunk(chunk: unknown, encoding?: unknown): string {
  const resolvedEncoding = isBufferEncoding(encoding) ? encoding : 'utf8';
  const rawText = typeof chunk === 'string' ? chunk : Buffer.isBuffer(chunk) ? chunk.toString(resolvedEncoding) : String(chunk ?? '');
  return rawText
    .replace(ANSI_ESCAPE_PATTERN, '')
    .replace(/\r\n/g, '\n')
    .replace(/\r(?!\n)/g, '\n');
}

function isBufferEncoding(value: unknown): value is BufferEncoding {
  return typeof value === 'string';
}
