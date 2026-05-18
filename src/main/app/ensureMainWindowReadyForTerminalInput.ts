import type { BrowserWindow } from 'electron';

const MAIN_WINDOW_ACTIVATION_SETTLE_MS = 200;

export async function ensureMainWindowReadyForTerminalInput(mainWindow: BrowserWindow | undefined): Promise<void> {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return;
  }

  let attemptedActivation = false;
  if (mainWindow.isMinimized()) {
    mainWindow.restore();
    attemptedActivation = true;
  }

  if (!mainWindow.isVisible()) {
    mainWindow.show();
    attemptedActivation = true;
  }

  if (!mainWindow.isFocused()) {
    mainWindow.show();
    mainWindow.focus();
    mainWindow.moveTop();
    attemptedActivation = true;
  }

  if (attemptedActivation) {
    await wait(MAIN_WINDOW_ACTIVATION_SETTLE_MS);
  }
}

function wait(durationMs: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, durationMs));
}
