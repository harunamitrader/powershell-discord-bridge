import { Terminal } from '@xterm/xterm';

interface CreateTerminalOptions {
  cols: number;
  rows: number;
  scrollback?: number;
}

export function createTerminalInstance(options: CreateTerminalOptions): Terminal {
  return new Terminal({
    allowProposedApi: false,
    cursorBlink: true,
    cursorStyle: 'block',
    convertEol: true,
    cols: options.cols,
    rows: options.rows,
    fontFamily: "Consolas, 'Cascadia Mono', monospace",
    fontSize: 14,
    lineHeight: 1.2,
    scrollback: options.scrollback ?? 5000,
    theme: {
      background: '#1e1e1e',
      black: '#1e1e1e',
      blue: '#3794ff',
      brightBlack: '#666666',
      brightBlue: '#6cb6ff',
      brightCyan: '#4ec9b0',
      brightGreen: '#b5cea8',
      brightMagenta: '#d670d6',
      brightRed: '#f48771',
      brightWhite: '#ffffff',
      brightYellow: '#dcdcaa',
      cursor: '#ffffff',
      cyan: '#4ec9b0',
      foreground: '#cccccc',
      green: '#608b4e',
      magenta: '#c586c0',
      red: '#cd3131',
      selectionBackground: '#264f78',
      white: '#d4d4d4',
      yellow: '#dcdcaa'
    }
  });
}
