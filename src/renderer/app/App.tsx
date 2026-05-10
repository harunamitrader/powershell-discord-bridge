import { useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react';
import type { BootstrapState, TerminalSessionSummary } from '../../shared/terminal';
import { TerminalViewport } from '../components/TerminalViewport';

const MIN_SIDEBAR_WIDTH = 240;
const MAX_SIDEBAR_WIDTH = 420;

export function App() {
  const [bootstrapState, setBootstrapState] = useState<BootstrapState | null>(null);
  const [sessions, setSessions] = useState<TerminalSessionSummary[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [sidebarWidth, setSidebarWidth] = useState(280);
  const [isCreatingSession, setIsCreatingSession] = useState(false);
  const [renamingSessionId, setRenamingSessionId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState('');
  const [pendingCloseSession, setPendingCloseSession] = useState<TerminalSessionSummary | null>(null);
  const activeSessionIdRef = useRef<string | null>(null);
  const snapshotPublishTimerRef = useRef<number | null>(null);

  useEffect(() => {
    const unsubscribeUpdated = window.terminalApp.onSessionUpdated((session) => {
      setSessions((current) => upsertSession(current, session));
      setActiveSessionId((current) => current ?? session.id);
      scheduleViewSnapshotPublish();
    });

    const unsubscribeExit = window.terminalApp.onSessionExit(({ sessionId }) => {
      setSessions((current) => {
        const remaining = current.filter((session) => session.id !== sessionId);
        setActiveSessionId((active) => (active === sessionId ? remaining.at(-1)?.id ?? null : active));
        return remaining;
      });
      setPendingCloseSession((current) => (current?.id === sessionId ? null : current));
      setRenamingSessionId((current) => (current === sessionId ? null : current));
      scheduleViewSnapshotPublish();
    });

    const unsubscribeData = window.terminalApp.onSessionData((event) => {
      if (event.sessionId === activeSessionIdRef.current) {
        scheduleViewSnapshotPublish();
      }
    });

    void (async () => {
      const state = await window.terminalApp.bootstrap();
      setBootstrapState(state);
      setSidebarWidth(state.sidebarWidth);
      await createSession();
    })();

    return () => {
      unsubscribeUpdated();
      unsubscribeExit();
      unsubscribeData();
      if (snapshotPublishTimerRef.current !== null) {
        window.clearTimeout(snapshotPublishTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (bootstrapState) {
      void window.terminalApp.setSidebarWidth({ width: sidebarWidth });
    }
  }, [bootstrapState, sidebarWidth]);

  useEffect(() => {
    activeSessionIdRef.current = activeSessionId;
    scheduleViewSnapshotPublish();
  }, [activeSessionId, sessions]);

  const activeSession = useMemo(
    () => sessions.find((session) => session.id === activeSessionId) ?? null,
    [activeSessionId, sessions]
  );
  const activeSessionBusy = activeSession?.inputLocked ?? false;

  async function createSession() {
    setIsCreatingSession(true);
    try {
      const session = await window.terminalApp.createSession();
      setSessions((current) => upsertSession(current, session));
      setActiveSessionId(session.id);
    } finally {
      setIsCreatingSession(false);
    }
  }

  async function closeSession(sessionId: string) {
    await window.terminalApp.closeSession(sessionId);
  }

  async function submitRenameSession(sessionId: string, nextTitle: string) {
    const updated = await window.terminalApp.renameSession({
      sessionId,
      title: nextTitle.trim()
    });

    setSessions((current) => upsertSession(current, updated));
    setRenamingSessionId(null);
    setRenameDraft('');
  }

  function beginRenameSession(session: TerminalSessionSummary) {
    setActiveSessionId(session.id);
    setRenamingSessionId(session.id);
    setRenameDraft(formatSessionTitle(session));
  }

  function cancelRenameSession() {
    setRenamingSessionId(null);
    setRenameDraft('');
  }

  function requestCloseSession(session: TerminalSessionSummary, event: ReactMouseEvent<HTMLElement>) {
    event.preventDefault();
    event.stopPropagation();
    setPendingCloseSession(session);
  }

  function cancelCloseSession() {
    setPendingCloseSession(null);
  }

  async function confirmCloseSession() {
    if (!pendingCloseSession) {
      return;
    }

    const sessionId = pendingCloseSession.id;
    setPendingCloseSession(null);
    await closeSession(sessionId);
  }

  function beginSidebarResize(event: ReactMouseEvent<HTMLDivElement>) {
    event.preventDefault();
    const startingPoint = event.clientX;
    const startingWidth = sidebarWidth;

    const handlePointerMove = (pointerEvent: MouseEvent) => {
      const nextWidth = clamp(startingWidth + pointerEvent.clientX - startingPoint, MIN_SIDEBAR_WIDTH, MAX_SIDEBAR_WIDTH);
      setSidebarWidth(nextWidth);
    };

    const stopResizing = () => {
      window.removeEventListener('mousemove', handlePointerMove);
      window.removeEventListener('mouseup', stopResizing);
    };

    window.addEventListener('mousemove', handlePointerMove);
    window.addEventListener('mouseup', stopResizing);
  }

  function scheduleViewSnapshotPublish() {
    if (snapshotPublishTimerRef.current !== null) {
      window.clearTimeout(snapshotPublishTimerRef.current);
    }

    snapshotPublishTimerRef.current = window.setTimeout(() => {
      snapshotPublishTimerRef.current = null;
      void window.terminalApp.publishLiveViewSnapshot({
        activeSessionId: activeSessionIdRef.current
      });
    }, 120);
  }

  return (
    <div className="app-shell">
      <div className="workspace-shell">
        <header className="titlebar">
          <div className="titlebar__left">
            <span className="titlebar__eyebrow">PowerShell</span>
            <span className="titlebar__title">Discord Bridge</span>
          </div>
          <div className="titlebar__meta">
            <span>{bootstrapState?.shellLabel ?? 'PowerShell'}</span>
            <span>{activeSession?.cwd ?? bootstrapState?.defaultCwd ?? ''}</span>
          </div>
        </header>

        <div className="panel-shell">
          <aside className="tabs-sidebar" style={{ width: sidebarWidth }}>
            <div className="tabs-sidebar__header">
              <div>
                <div className="tabs-sidebar__label">TERMINALS</div>
                <div className="tabs-sidebar__caption">{sessions.length} active</div>
              </div>
              <button className="action-button" onClick={() => void createSession()} disabled={isCreatingSession}>
                New
              </button>
            </div>

            <div className="tabs-list">
              {sessions.length === 0 ? (
                <div className="empty-state">No active terminals</div>
              ) : (
                sessions.map((session) => {
                  const label = session.title || formatSessionTitle(session);
                  const statusLabel = getTabStatusLabel(session);
                  return (
                    <button
                      key={session.id}
                      className={session.id === activeSessionId ? 'tab-item tab-item--active' : 'tab-item'}
                      onClick={() => setActiveSessionId(session.id)}
                      onDoubleClick={() => beginRenameSession(session)}
                    >
                      <div className="tab-item__body">
                        <span className="tab-item__title">{label}</span>
                        <span className="tab-item__detail">{session.cwd ?? bootstrapState?.defaultCwd ?? 'PowerShell'}</span>
                      </div>
                      <span className={statusLabel.className}>{statusLabel.label}</span>
                      <span
                        className="tab-item__close"
                        onClick={(event) => requestCloseSession(session, event)}
                        role="button"
                        aria-label={`Close ${label}`}
                        title={`Close ${label}`}
                      >
                        x
                      </span>
                    </button>
                  );
                })
              )}
            </div>

            <div className="sidebar-resize-handle" onMouseDown={beginSidebarResize} />
          </aside>

          <main className="terminal-panel">
            <div className="terminal-panel__toolbar">
              <div className="terminal-panel__title-group">
                {activeSession && renamingSessionId === activeSession.id ? (
                  <div className="rename-editor">
                    <input
                      className="rename-editor__input"
                      value={renameDraft}
                      onChange={(event) => setRenameDraft(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') {
                          event.preventDefault();
                          void submitRenameSession(activeSession.id, renameDraft);
                        }
                        if (event.key === 'Escape') {
                          event.preventDefault();
                          cancelRenameSession();
                        }
                      }}
                      autoFocus
                    />
                    <button
                      className="action-button"
                      onClick={() => void submitRenameSession(activeSession.id, renameDraft)}
                    >
                      Save
                    </button>
                    <button className="action-button" onClick={cancelRenameSession}>
                      Cancel
                    </button>
                  </div>
                ) : (
                  <span className="terminal-panel__title">{activeSession ? formatSessionTitle(activeSession) : 'PowerShell'}</span>
                )}
                <span className="terminal-panel__subtitle">{activeSession?.cwd ?? bootstrapState?.defaultCwd ?? ''}</span>
              </div>
            </div>

            {activeSession ? (
              <div className={activeSessionBusy ? 'terminal-panel__notice terminal-panel__notice--busy' : 'terminal-panel__notice'}>
                <span>{describeSessionState(activeSession)}</span>
              </div>
            ) : null}

            <div className="terminal-panel__viewport">
              {sessions.map((session) => (
                <TerminalViewport
                  key={session.id}
                  session={session}
                  isActive={session.id === activeSessionId}
                />
              ))}

              {sessions.length === 0 ? (
                <div className="viewport-empty-state">
                  <div className="viewport-empty-state__title">Start a terminal session</div>
                  <button className="action-button" onClick={() => void createSession()}>
                    Open PowerShell
                  </button>
                </div>
              ) : null}
            </div>
          </main>
        </div>
      </div>

      {pendingCloseSession ? (
        <div className="confirm-overlay" role="dialog" aria-modal="true">
          <div className="confirm-dialog">
            <div className="confirm-dialog__title">Kill this terminal?</div>
            <div className="confirm-dialog__body">
              <div>{formatSessionTitle(pendingCloseSession)}</div>
              <div>{pendingCloseSession.cwd ?? bootstrapState?.defaultCwd ?? ''}</div>
            </div>
            <div className="confirm-dialog__actions">
              <button className="action-button" onClick={cancelCloseSession}>
                Cancel
              </button>
              <button className="action-button action-button--danger" onClick={() => void confirmCloseSession()}>
                Kill terminal
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function upsertSession(current: TerminalSessionSummary[], next: TerminalSessionSummary): TerminalSessionSummary[] {
  const existingIndex = current.findIndex((session) => session.id === next.id);
  if (existingIndex === -1) {
    return [...current, next];
  }

  const updated = [...current];
  updated[existingIndex] = next;
  return updated;
}

function formatSessionTitle(session: TerminalSessionSummary): string {
  if (session.title) {
    return session.title;
  }

  if (session.cwd) {
    const normalized = session.cwd.replace(/[\\/]+$/, '');
    const segments = normalized.split(/[\\/]/);
    return segments.at(-1) || session.shellLabel;
  }

  return session.shellLabel;
}

function describeSessionState(session: TerminalSessionSummary): string {
  if (session.status === 'exited') {
    return 'Session exited';
  }

  if (session.inputLocked) {
    return 'Discord bridge active. Local terminal input is locked until the current bridge turn completes.';
  }

  if (session.mode === 'bridge') {
    return 'Bridge-managed session. Discord can drive this terminal channel.';
  }

  return 'Local terminal session.';
}

function getTabStatusLabel(session: TerminalSessionSummary): { label: string; className: string } {
  if (session.status === 'exited') {
    return {
      label: 'EXIT',
      className: 'tab-item__status tab-item__status--exit'
    };
  }

  if (session.inputLocked) {
    return {
      label: 'BUSY',
      className: 'tab-item__status tab-item__status--busy'
    };
  }

  if (session.mode === 'bridge') {
    return {
      label: 'BRDG',
      className: 'tab-item__status tab-item__status--bridge'
    };
  }

  return {
    label: 'LIVE',
    className: 'tab-item__status'
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
