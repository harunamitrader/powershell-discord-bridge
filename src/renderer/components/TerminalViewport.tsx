import { useEffect, useRef } from 'react';
import { FitAddon } from '@xterm/addon-fit';
import type { Terminal } from '@xterm/xterm';
import type { TerminalSessionSummary } from '../../shared/terminal';
import { createTerminalInstance } from './terminalAppearance';

interface TerminalViewportProps {
  session: TerminalSessionSummary;
  focused: boolean;
  onActivate?: () => void;
}

export function TerminalViewport({ session, focused, onActivate }: TerminalViewportProps) {
  const surfaceRef = useRef<HTMLDivElement | null>(null);
  const wellRef = useRef<HTMLDivElement | null>(null);
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const onActivateRef = useRef(onActivate);

  useEffect(() => {
    onActivateRef.current = onActivate;
  }, [onActivate]);

  useEffect(() => {
    if (!surfaceRef.current || !wellRef.current || !viewportRef.current || !containerRef.current || terminalRef.current) {
      return;
    }

    const terminal = createTerminalInstance({
      cols: session.cols,
      rows: session.rows,
      scrollback: 5000
    });

    const fitAddon = new FitAddon();
    terminal.loadAddon(fitAddon);
    terminal.open(containerRef.current);
    terminal.attachCustomKeyEventHandler((event) => {
      if (event.type === 'keydown' && isCopyShortcut(event) && terminal.hasSelection()) {
        event.preventDefault();
        void window.terminalApp.writeClipboard(terminal.getSelection()).catch((error: unknown) => {
          console.error('Clipboard write failed', error);
        });
        return false;
      }

      if (event.type === 'keydown' && isPasteShortcut(event)) {
        event.preventDefault();
        void pasteClipboardIntoTerminal(session.id);
        return false;
      }

      return true;
    });
    terminalRef.current = terminal;
    fitAddonRef.current = fitAddon;

    const unsubscribeData = window.terminalApp.onSessionData((event) => {
      if (event.sessionId === session.id) {
        terminal.write(event.data);
      }
    });

    const unsubscribeExit = window.terminalApp.onSessionExit((event) => {
      if (event.sessionId === session.id) {
        terminal.writeln(`\r\n\x1b[90mTerminal exited with code ${event.exitCode}\x1b[0m`);
      }
    });

    terminal.onData((data) => {
      void window.terminalApp.write(session.id, data).catch((error: unknown) => {
        console.error('Terminal write rejected', error);
      });
    });

    let resizeObserver: ResizeObserver | undefined;
    if (session.resizeMode === 'fit') {
      resizeObserver = new ResizeObserver(() => {
        if (fitAddonRef.current && terminalRef.current) {
          fitAndSync(session.id, fitAddonRef.current, terminalRef.current);
        }
      });

      resizeObserver.observe(viewportRef.current);
      fitAndSync(session.id, fitAddon, terminal);
    } else {
      terminal.resize(session.cols, session.rows);
    }

    containerRef.current.addEventListener('mousedown', handleActivate);

    return () => {
      unsubscribeData();
      unsubscribeExit();
      resizeObserver?.disconnect();
      containerRef.current?.removeEventListener('mousedown', handleActivate);
      terminal.dispose();
      terminalRef.current = null;
      fitAddonRef.current = null;
    };

    function handleActivate() {
      onActivateRef.current?.();
      terminal.focus();
    }
  }, [session.id]);

  useEffect(() => {
    if (!terminalRef.current) {
      return;
    }

    if (session.resizeMode === 'fit') {
      if (!fitAddonRef.current) {
        return;
      }

      fitAndSync(session.id, fitAddonRef.current, terminalRef.current);
    } else {
      terminalRef.current.resize(session.cols, session.rows);
    }

    if (focused) {
      terminalRef.current.focus();
    }
  }, [focused, session.cols, session.rows, session.id, session.resizeMode]);

  const surfaceClassName =
    focused ? 'terminal-viewport__surface terminal-viewport__surface--focused' : 'terminal-viewport__surface';
  const wellClassName = session.resizeMode === 'fixed' ? 'terminal-viewport__well terminal-viewport__well--fixed' : 'terminal-viewport__well';
  const viewportClassName =
    session.resizeMode === 'fixed'
      ? 'terminal-viewport__viewport terminal-viewport__viewport--fixed'
      : 'terminal-viewport__viewport';
  const mountClassName =
    session.resizeMode === 'fixed' ? 'terminal-viewport__mount terminal-viewport__mount--fixed' : 'terminal-viewport__mount';

  return (
    <div className="terminal-viewport">
      <div ref={surfaceRef} className={surfaceClassName}>
        <div ref={wellRef} className={wellClassName}>
          <div ref={viewportRef} className={viewportClassName}>
            <div ref={containerRef} className={mountClassName} />
          </div>
        </div>
      </div>
    </div>
  );
}

function fitAndSync(sessionId: string, fitAddon: FitAddon, terminal: Terminal) {
  fitAddon.fit();
  const dimensions = fitAddon.proposeDimensions();
  if (!dimensions) {
    return;
  }

  void window.terminalApp.resize(sessionId, dimensions.cols, dimensions.rows);
}

function isCopyShortcut(event: KeyboardEvent): boolean {
  if (event.altKey) {
    return false;
  }

  return (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'c';
}

function isPasteShortcut(event: KeyboardEvent): boolean {
  if (event.altKey) {
    return false;
  }

  return (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'v';
}

async function pasteClipboardIntoTerminal(sessionId: string): Promise<void> {
  try {
    const text = await window.terminalApp.readClipboard();
    if (!text) {
      return;
    }

    await window.terminalApp.write(sessionId, text);
  } catch (error: unknown) {
    console.error('Clipboard paste failed', error);
  }
}
