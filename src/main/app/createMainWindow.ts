import { app, BrowserWindow, dialog, shell } from 'electron';
import path from 'node:path';
import { PreferencesStore } from './preferencesStore';

const DEFAULT_WINDOW = {
  width: 1480,
  height: 920
};

export function createMainWindow(preferencesStore: PreferencesStore): BrowserWindow {
  const bounds = preferencesStore.getWindowBounds();
  let allowClose = false;
  const window = new BrowserWindow({
    width: bounds?.width ?? DEFAULT_WINDOW.width,
    height: bounds?.height ?? DEFAULT_WINDOW.height,
    x: bounds?.x,
    y: bounds?.y,
    minWidth: 1100,
    minHeight: 720,
    autoHideMenuBar: true,
    backgroundColor: '#181818',
    title: 'PowerShell Discord Bridge',
    webPreferences: {
      preload: path.resolve(__dirname, '../../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });

  app.on('before-quit', () => {
    allowClose = true;
  });

  window.on('close', (event) => {
    preferencesStore.setWindowBounds(window.getBounds());
    if (allowClose) {
      return;
    }

    const choice = dialog.showMessageBoxSync(window, {
      type: 'question',
      buttons: ['Cancel', 'Exit'],
      defaultId: 0,
      cancelId: 0,
      noLink: true,
      message: 'PowerShell Discord Bridge を終了しますか？',
      detail: '開いているターミナルセッションも終了します。'
    });
    if (choice === 0) {
      event.preventDefault();
      return;
    }

    allowClose = true;
  });

  window.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: 'deny' };
  });

  window.once('ready-to-show', () => {
    window.show();
  });

  const rendererUrl = process.env.ELECTRON_RENDERER_URL;
  if (rendererUrl) {
    void window.loadURL(rendererUrl);
  } else {
    void window.loadFile(path.resolve(__dirname, '../../../dist/renderer/index.html'));
  }

  return window;
}
