import type { BrowserWindow } from 'electron';

export async function captureWindowScreenshotPng(window: BrowserWindow, captureDelayMs: number): Promise<Buffer> {
  if (window.isDestroyed()) {
    throw new Error('Main window is not available for screenshot capture.');
  }

  await wait(captureDelayMs);
  const image = await window.webContents.capturePage();
  if (image.isEmpty()) {
    throw new Error('Failed to capture app window screenshot.');
  }

  return image.toPNG();
}

export function buildWindowScreenshotFilename(capturedAt: string): string {
  return `app-window-${capturedAt.replace(/[:.]/g, '-')}.png`;
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
