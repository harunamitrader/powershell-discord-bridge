import { useEffect, useRef } from 'react';
import { FitAddon } from '@xterm/addon-fit';
import { Terminal } from '@xterm/xterm';
import type { TerminalSessionSummary } from '../../shared/terminal';

interface TerminalViewportProps {
  session: TerminalSessionSummary;
  focused: boolean;
  onActivate?: () => void;
}

export function TerminalViewport({ session, focused, onActivate }: TerminalViewportProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const onActivateRef = useRef(onActivate);

  useEffect(() => {
    onActivateRef.current = onActivate;
  }, [onActivate]);

  useEffect(() => {
    if (!containerRef.current || terminalRef.current) {
      return;
    }

    const terminal = new Terminal({
      allowProposedApi: false,
      cursorBlink: true,
      cursorStyle: 'block',
      convertEol: true,
      cols: session.cols,
      rows: session.rows,
      fontFamily: "Consolas, 'Cascadia Mono', monospace",
      fontSize: 14,
      lineHeight: 1.2,
      scrollback: 5000,
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

    const fitAddon = new FitAddon();
    terminal.loadAddon(fitAddon);
    terminal.open(containerRef.current);
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

      resizeObserver.observe(containerRef.current);
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
    session.resizeMode === 'fixed' ? 'terminal-viewport__surface terminal-viewport__surface--fixed' : 'terminal-viewport__surface';

  return (
    <div className="terminal-viewport">
      <div ref={containerRef} className={surfaceClassName} />
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
