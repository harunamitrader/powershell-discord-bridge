import { useEffect, useMemo, useRef, useState } from 'react';
import type { TerminalScreenshotExportData } from '../../shared/terminal';
import { createTerminalInstance } from '../components/terminalAppearance';

type ExportState = 'loading' | 'ready' | 'error';

export function TerminalExportPage() {
  const searchParams = useMemo(() => new URLSearchParams(window.location.search), []);
  const sessionId = searchParams.get('sessionId')?.trim() ?? '';
  const mountRef = useRef<HTMLDivElement | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let disposed = false;
    let terminal = createTerminalInstance({
      cols: 80,
      rows: 24,
      scrollback: 5000
    });

    document.documentElement.classList.add('terminal-export-mode');
    document.body.classList.add('terminal-export-mode');
    setExportDocumentState('loading');

    void (async () => {
      try {
        if (!sessionId) {
          throw new Error('Missing sessionId for terminal export.');
        }

        const exportData = await window.terminalApp.getTerminalScreenshotExport(sessionId);
        await waitForFonts();

        if (disposed || !mountRef.current) {
          return;
        }

        terminal.dispose();
        terminal = createTerminalInstance({
          cols: exportData.cols,
          rows: exportData.rows,
          scrollback: 5000
        });
        terminal.open(mountRef.current);

        if (exportData.transcript.length > 0) {
          await writeTerminal(terminal, exportData.transcript);
        }

        if (disposed) {
          return;
        }

        document.title = buildExportTitle(exportData);
        await waitForPaint();
        setExportDocumentState('ready');
      } catch (caughtError) {
        const message = caughtError instanceof Error ? caughtError.message : String(caughtError);
        if (!disposed) {
          setError(message);
          setExportDocumentState('error', message);
        }
      }
    })();

    return () => {
      disposed = true;
      document.body.classList.remove('terminal-export-mode');
      document.documentElement.classList.remove('terminal-export-mode');
      terminal.dispose();
    };
  }, [sessionId]);

  return (
    <div className="terminal-export-page">
      {error ? (
        <div className="terminal-export-page__error">{error}</div>
      ) : (
        <div className="terminal-export-page__surface terminal-viewport__surface" data-terminal-export-root="true">
          <div className="terminal-viewport__well terminal-viewport__well--fixed">
            <div className="terminal-export-page__viewport terminal-viewport__viewport terminal-viewport__viewport--fixed">
              <div ref={mountRef} className="terminal-export-page__mount terminal-viewport__mount terminal-viewport__mount--fixed" />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function setExportDocumentState(state: ExportState, message = ''): void {
  document.body.dataset.terminalExportState = state;
  if (message) {
    document.body.dataset.terminalExportError = message;
  } else {
    delete document.body.dataset.terminalExportError;
  }
}

function buildExportTitle(exportData: TerminalScreenshotExportData): string {
  return exportData.title?.trim() || exportData.sessionId;
}

async function writeTerminal(
  terminal: ReturnType<typeof createTerminalInstance>,
  transcript: string
): Promise<void> {
  await new Promise<void>((resolve) => {
    terminal.write(transcript, () => resolve());
  });
}

async function waitForFonts(): Promise<void> {
  if ('fonts' in document) {
    await document.fonts.ready;
  }
}

async function waitForPaint(): Promise<void> {
  await new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()));
  await new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()));
}
