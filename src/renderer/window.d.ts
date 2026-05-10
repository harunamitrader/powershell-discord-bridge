import type { TerminalApi } from '../shared/terminal';

declare global {
  interface Window {
    terminalApp: TerminalApi;
  }
}

export {};
