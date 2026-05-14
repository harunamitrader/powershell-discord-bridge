import { BrowserWindow } from 'electron';
import path from 'node:path';

const INITIAL_WINDOW_WIDTH = 1200;
const INITIAL_WINDOW_HEIGHT = 900;
const EXPORT_READY_TIMEOUT_MS = 10000;
const EXPORT_POLL_INTERVAL_MS = 50;
const RESIZE_SETTLE_MS = 120;

interface ExportWindowState {
  state: 'loading' | 'ready' | 'error';
  error: string;
}

interface ExportWindowSize {
  width: number;
  height: number;
}

interface ExportCaptureRect extends ExportWindowSize {
  x: number;
  y: number;
}

export async function captureTerminalScreenshotPng(sessionId: string): Promise<Buffer> {
  const window = createExportWindow();

  try {
    await loadExportWindow(window, sessionId);
    await waitForExportReady(window);

    const size = await getExportWindowSize(window);
    window.setContentSize(size.width, size.height);
    await wait(RESIZE_SETTLE_MS);

    const captureRect = await getExportCaptureRect(window);
    const image = await window.webContents.capturePage(captureRect);
    if (image.isEmpty()) {
      throw new Error('Failed to capture terminal screenshot.');
    }

    return image.toPNG();
  } finally {
    if (!window.isDestroyed()) {
      window.destroy();
    }
  }
}

export function buildTerminalScreenshotFilename(capturedAt: string): string {
  return `terminal-${capturedAt.replace(/[:.]/g, '-')}.png`;
}

function createExportWindow(): BrowserWindow {
  return new BrowserWindow({
    show: false,
    width: INITIAL_WINDOW_WIDTH,
    height: INITIAL_WINDOW_HEIGHT,
    useContentSize: true,
    backgroundColor: '#1e1e1e',
    autoHideMenuBar: true,
    paintWhenInitiallyHidden: true,
    webPreferences: {
      preload: path.resolve(__dirname, '../../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      backgroundThrottling: false
    }
  });
}

async function loadExportWindow(window: BrowserWindow, sessionId: string): Promise<void> {
  const rendererUrl = process.env.ELECTRON_RENDERER_URL;
  if (rendererUrl) {
    const exportUrl = new URL(rendererUrl);
    exportUrl.searchParams.set('terminal-export', '1');
    exportUrl.searchParams.set('sessionId', sessionId);
    await window.loadURL(exportUrl.toString());
    return;
  }

  await window.loadFile(path.resolve(__dirname, '../../../dist/renderer/index.html'), {
    query: {
      'terminal-export': '1',
      sessionId
    }
  });
}

async function waitForExportReady(window: BrowserWindow): Promise<void> {
  const deadline = Date.now() + EXPORT_READY_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const exportState = await getExportWindowState(window);
    if (exportState.state === 'ready') {
      return;
    }

    if (exportState.state === 'error') {
      throw new Error(exportState.error || 'Terminal screenshot export failed.');
    }

    await wait(EXPORT_POLL_INTERVAL_MS);
  }

  throw new Error('Timed out while rendering terminal screenshot.');
}

async function getExportWindowState(window: BrowserWindow): Promise<ExportWindowState> {
  return window.webContents.executeJavaScript(
    `(() => ({
      state: document.body?.dataset?.terminalExportState || 'loading',
      error: document.body?.dataset?.terminalExportError || ''
    }))()`,
    true
  ) as Promise<ExportWindowState>;
}

async function getExportWindowSize(window: BrowserWindow): Promise<ExportWindowSize> {
  const size = (await window.webContents.executeJavaScript(
    `(() => ({
      width: Math.ceil(document.documentElement.scrollWidth || document.body?.scrollWidth || 0),
      height: Math.ceil(document.documentElement.scrollHeight || document.body?.scrollHeight || 0)
    }))()`,
    true
  )) as ExportWindowSize;

  return {
    width: Math.max(1, size.width),
    height: Math.max(1, size.height)
  };
}

async function getExportCaptureRect(window: BrowserWindow): Promise<ExportCaptureRect> {
  const rect = (await window.webContents.executeJavaScript(
    `(() => {
      const root = document.querySelector('[data-terminal-export-root="true"]');
      if (!root) {
        return { x: 0, y: 0, width: window.innerWidth, height: window.innerHeight };
      }

      const box = root.getBoundingClientRect();
      return {
        x: Math.max(0, Math.floor(box.left)),
        y: Math.max(0, Math.floor(box.top)),
        width: Math.max(1, Math.ceil(box.width)),
        height: Math.max(1, Math.ceil(box.height))
      };
    })()`,
    true
  )) as ExportCaptureRect;

  return rect;
}

function wait(durationMs: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, durationMs);
  });
}
