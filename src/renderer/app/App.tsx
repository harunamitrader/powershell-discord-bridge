import { useEffect, useMemo, useRef, useState, type Dispatch, type KeyboardEvent as ReactKeyboardEvent, type SetStateAction } from 'react';
import type {
  BootstrapState,
  BridgeSettings,
  TerminalSessionSummary,
  TerminalSlotId,
  TerminalSlotSettings
} from '../../shared/terminal';
import { TerminalViewport } from '../components/TerminalViewport';

interface SettingsDraft {
  defaultWorkspaceCwd: string;
  autoScreenshotOnReply: boolean;
  softTimeoutMs: string;
  hardTimeoutMs: string;
  bridgeCols: string;
  bridgeRows: string;
}

export function App() {
  const [bootstrapState, setBootstrapState] = useState<BootstrapState | null>(null);
  const [sessions, setSessions] = useState<TerminalSessionSummary[]>([]);
  const [slotSettings, setSlotSettings] = useState<TerminalSlotSettings[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [bridgeSettings, setBridgeSettings] = useState<BridgeSettings>({
    autoScreenshotOnReply: false,
    softTimeoutMs: 20000,
    hardTimeoutMs: 120000,
    bridgeDimensions: {
      cols: 120,
      rows: 32
    }
  });
  const [settingsDraft, setSettingsDraft] = useState<SettingsDraft>({
    defaultWorkspaceCwd: '',
    autoScreenshotOnReply: false,
    softTimeoutMs: '20000',
    hardTimeoutMs: '120000',
    bridgeCols: '120',
    bridgeRows: '32'
  });
  const [slotDrafts, setSlotDrafts] = useState<TerminalSlotSettings[]>([]);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [isSavingSettings, setIsSavingSettings] = useState(false);
  const [restartingSlotId, setRestartingSlotId] = useState<TerminalSlotId | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [settingsError, setSettingsError] = useState<string | null>(null);
  const [renamingSessionId, setRenamingSessionId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState('');
  const activeSessionIdRef = useRef<string | null>(null);
  const snapshotPublishTimerRef = useRef<number | null>(null);

  useEffect(() => {
    const unsubscribeUpdated = window.terminalApp.onSessionUpdated((session) => {
      setSessions((current) => upsertSession(current, session));
      setActiveSessionId((current) => current ?? session.id);
      scheduleViewSnapshotPublish();
    });

    const unsubscribeExit = window.terminalApp.onSessionExit(({ sessionId }) => {
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
      setSessions(state.sessions);
      setSlotSettings(state.terminalSlots);
      setBridgeSettings(state.bridgeSettings);
      setSettingsDraft(createSettingsDraft(state.defaultWorkspaceCwd, state.bridgeSettings));
      setSlotDrafts(state.terminalSlots);
      setActiveSessionId(state.sessions[0]?.id ?? null);
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
    activeSessionIdRef.current = activeSessionId;
    scheduleViewSnapshotPublish();
  }, [activeSessionId, sessions]);

  const slots = useMemo(
    () => [...slotSettings].sort((left, right) => left.slotId - right.slotId),
    [slotSettings]
  );

  const sessionsBySlot = useMemo(() => {
    const map = new Map<TerminalSlotId, TerminalSessionSummary>();
    for (const session of sessions) {
      if (session.slotId) {
        map.set(session.slotId, session);
      }
    }
    return map;
  }, [sessions]);

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

  function openSettings() {
    setSettingsError(null);
    setSettingsDraft(createSettingsDraft(bootstrapState?.defaultWorkspaceCwd ?? '', bridgeSettings));
    setSlotDrafts(slotSettings);
    setSettingsOpen(true);
  }

  function closeSettings() {
    if (isSavingSettings) {
      return;
    }

    setSettingsOpen(false);
    setSettingsError(null);
  }

  async function saveSettings() {
    const softTimeoutMs = Number(settingsDraft.softTimeoutMs);
    const hardTimeoutMs = Number(settingsDraft.hardTimeoutMs);
    const cols = Number(settingsDraft.bridgeCols);
    const rows = Number(settingsDraft.bridgeRows);

    if (!Number.isFinite(softTimeoutMs) || !Number.isFinite(hardTimeoutMs) || !Number.isFinite(cols) || !Number.isFinite(rows)) {
      setSettingsError('数値設定を確認してください。');
      return;
    }

    setIsSavingSettings(true);
    setSettingsError(null);
    setFeedback(null);

    try {
      const updatedBridgeSettings = await window.terminalApp.updateBridgeSettings({
        autoScreenshotOnReply: settingsDraft.autoScreenshotOnReply,
        softTimeoutMs,
        hardTimeoutMs,
        bridgeDimensions: {
          cols,
          rows
        }
      });
      setBridgeSettings(updatedBridgeSettings);

      const savedCwd = await window.terminalApp.setDefaultWorkspaceCwd(settingsDraft.defaultWorkspaceCwd);

      const updatedSlots: TerminalSlotSettings[] = [];
      for (const slotDraft of slotDrafts) {
        const result = await window.terminalApp.updateTerminalSlot(slotDraft);
        updatedSlots.push(result.slot);
        if (result.session) {
          const session = result.session;
          setSessions((current) => upsertSession(current, session));
        }
      }

      setSlotSettings(updatedSlots);
      setBootstrapState((current) =>
        current
          ? {
              ...current,
              defaultCwd: savedCwd,
              defaultWorkspaceCwd: savedCwd,
              bridgeSettings: updatedBridgeSettings,
              terminalSlots: updatedSlots
            }
          : current
      );
      setSettingsOpen(false);
      setFeedback('設定を保存しました。');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setSettingsError(message);
    } finally {
      setIsSavingSettings(false);
    }
  }

  async function restartSlot(slotId: TerminalSlotId) {
    setRestartingSlotId(slotId);
    setFeedback(null);
    try {
      const session = await window.terminalApp.restartTerminalSlot(slotId);
      setSessions((current) => upsertSession(current, session));
      setActiveSessionId(session.id);
      setFeedback(`${findSlotName(slotSettings, slotId)} を再起動しました。`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setFeedback(`再起動に失敗しました: ${message}`);
    } finally {
      setRestartingSlotId(null);
    }
  }

  async function submitRenameSession(session: TerminalSessionSummary, nextTitle: string) {
    try {
      const updated = await window.terminalApp.renameSession({
        sessionId: session.id,
        title: nextTitle.trim()
      });
      setSessions((current) => upsertSession(current, updated));
      setSlotSettings((current) =>
        current.map((slot) => (slot.slotId === session.slotId ? { ...slot, workspaceName: updated.title ?? slot.workspaceName } : slot))
      );
      setRenamingSessionId(null);
      setRenameDraft('');
      if (updated.title) {
        setFeedback(`ワークスペース名を ${updated.title} に変更しました。`);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setFeedback(`名前変更に失敗しました: ${message}`);
    }
  }

  function beginRenameSession(session: TerminalSessionSummary) {
    setRenamingSessionId(session.id);
    setRenameDraft(session.title ?? findSlotName(slotSettings, session.slotId));
  }

  function cancelRenameSession() {
    setRenamingSessionId(null);
    setRenameDraft('');
  }

  function handleRenameKeyDown(event: ReactKeyboardEvent<HTMLInputElement>, session: TerminalSessionSummary) {
    if (event.key === 'Enter') {
      event.preventDefault();
      void submitRenameSession(session, renameDraft);
      return;
    }

    if (event.key === 'Escape') {
      event.preventDefault();
      cancelRenameSession();
    }
  }

  return (
    <div className="app-shell">
      <div className="workspace-shell">
        <header className="titlebar titlebar--main">
          <div className="titlebar__left">
            <span className="titlebar__eyebrow">PowerShell</span>
            <span className="titlebar__title">Discord Bridge</span>
          </div>
          <div className="titlebar__meta">
            <span>{bootstrapState?.shellLabel ?? 'PowerShell'}</span>
            <span>{bootstrapState?.defaultWorkspaceCwd ?? bootstrapState?.defaultCwd ?? ''}</span>
          </div>
          <div className="titlebar__actions">
            <button className="action-button" onClick={openSettings}>
              Settings
            </button>
          </div>
        </header>

        {feedback ? <div className="app-feedback">{feedback}</div> : null}

        <main className="terminal-grid">
          {slots.map((slot) => {
            const session = sessionsBySlot.get(slot.slotId) ?? null;
            const renaming = session && renamingSessionId === session.id;
            const status = getPaneStatus(session);
            return (
              <section
                key={slot.slotId}
                className={activeSessionId === session?.id ? 'terminal-tile terminal-tile--active' : 'terminal-tile'}
                onMouseDown={() => {
                  if (session) {
                    setActiveSessionId(session.id);
                  }
                }}
              >
                <div className="terminal-tile__header">
                  <div className="terminal-tile__header-main">
                    <span className="terminal-tile__slot-label">P{slot.slotId}</span>
                    {session && renaming ? (
                      <div className="rename-editor">
                        <input
                          className="rename-editor__input"
                          value={renameDraft}
                          onChange={(event) => setRenameDraft(event.target.value)}
                          onKeyDown={(event) => handleRenameKeyDown(event, session)}
                          autoFocus
                        />
                        <button className="action-button" onClick={() => void submitRenameSession(session, renameDraft)}>
                          Save
                        </button>
                        <button className="action-button" onClick={cancelRenameSession}>
                          Cancel
                        </button>
                      </div>
                    ) : (
                      <button
                        className="terminal-tile__title"
                        onDoubleClick={() => {
                          if (session) {
                            beginRenameSession(session);
                          }
                        }}
                      >
                        {session?.title ?? slot.workspaceName}
                      </button>
                    )}
                  </div>
                  <div className="terminal-tile__header-actions">
                    <span className={status.className}>{status.label}</span>
                    <button
                      className="action-button"
                      onClick={() => void restartSlot(slot.slotId)}
                      disabled={restartingSlotId === slot.slotId}
                    >
                      Restart
                    </button>
                  </div>
                </div>

                <div className="terminal-tile__meta">
                  <span>{slot.cwd}</span>
                  <span>{slot.channelId ? `Channel: ${slot.channelId}` : 'Channel: auto create on save/start'}</span>
                </div>

                <div className="terminal-tile__body">
                  {session ? (
                    <TerminalViewport
                      session={session}
                      focused={activeSessionId === session.id}
                      onActivate={() => setActiveSessionId(session.id)}
                    />
                  ) : (
                    <div className="terminal-tile__placeholder">
                      <div className="terminal-tile__placeholder-title">PowerShell unavailable</div>
                      <div className="terminal-tile__placeholder-body">Restart でこの枠の PowerShell を再作成できます。</div>
                    </div>
                  )}
                </div>
              </section>
            );
          })}
        </main>
      </div>

      {settingsOpen ? (
        <div className="settings-screen" role="dialog" aria-modal="true">
          <div className="settings-screen__panel">
            <header className="settings-screen__header">
              <div>
                <div className="settings-screen__title">Settings</div>
                <div className="settings-screen__subtitle">Global settings and per-terminal settings</div>
              </div>
              <button className="action-button" onClick={closeSettings} disabled={isSavingSettings}>
                Close
              </button>
            </header>

            <div className="settings-screen__content">
              <section className="settings-section">
                <h2 className="settings-section__title">Global</h2>
                <label className="settings-toggle">
                  <input
                    type="checkbox"
                    checked={settingsDraft.autoScreenshotOnReply}
                    onChange={(event) =>
                      setSettingsDraft((current) => ({
                        ...current,
                        autoScreenshotOnReply: event.target.checked
                      }))
                    }
                  />
                  <div className="settings-toggle__body">
                    <div className="settings-toggle__title">Auto screenshot after reply</div>
                    <div className="settings-toggle__description">Discord の各完了返信のあとに、アプリ画面全体を追加で送信します。</div>
                  </div>
                </label>

                <div className="settings-form">
                  <label className="settings-field">
                    <span className="settings-field__label">Default workspace directory</span>
                    <input
                      className="settings-field__input"
                      value={settingsDraft.defaultWorkspaceCwd}
                      onChange={(event) =>
                        setSettingsDraft((current) => ({
                          ...current,
                          defaultWorkspaceCwd: event.target.value
                        }))
                      }
                    />
                  </label>
                  <label className="settings-field">
                    <span className="settings-field__label">Soft timeout (ms)</span>
                    <input
                      className="settings-field__input"
                      type="number"
                      min={1000}
                      step={1000}
                      value={settingsDraft.softTimeoutMs}
                      onChange={(event) =>
                        setSettingsDraft((current) => ({
                          ...current,
                          softTimeoutMs: event.target.value
                        }))
                      }
                    />
                  </label>
                  <label className="settings-field">
                    <span className="settings-field__label">Hard timeout (ms)</span>
                    <input
                      className="settings-field__input"
                      type="number"
                      min={5000}
                      step={1000}
                      value={settingsDraft.hardTimeoutMs}
                      onChange={(event) =>
                        setSettingsDraft((current) => ({
                          ...current,
                          hardTimeoutMs: event.target.value
                        }))
                      }
                    />
                  </label>
                  <div className="settings-grid">
                    <label className="settings-field">
                      <span className="settings-field__label">Bridge cols</span>
                      <input
                        className="settings-field__input"
                        type="number"
                        min={40}
                        max={240}
                        step={1}
                        value={settingsDraft.bridgeCols}
                        onChange={(event) =>
                          setSettingsDraft((current) => ({
                            ...current,
                            bridgeCols: event.target.value
                          }))
                        }
                      />
                    </label>
                    <label className="settings-field">
                      <span className="settings-field__label">Bridge rows</span>
                      <input
                        className="settings-field__input"
                        type="number"
                        min={10}
                        max={80}
                        step={1}
                        value={settingsDraft.bridgeRows}
                        onChange={(event) =>
                          setSettingsDraft((current) => ({
                            ...current,
                            bridgeRows: event.target.value
                          }))
                        }
                      />
                    </label>
                  </div>
                </div>
              </section>

              <section className="settings-section">
                <h2 className="settings-section__title">Per terminal</h2>
                <div className="slot-settings-list">
                  {slotDrafts
                    .slice()
                    .sort((left, right) => left.slotId - right.slotId)
                    .map((slot) => (
                      <div key={slot.slotId} className="slot-settings-card">
                        <div className="slot-settings-card__title">P{slot.slotId}</div>
                        <div className="settings-form">
                          <label className="settings-field">
                            <span className="settings-field__label">Workspace name</span>
                            <input
                              className="settings-field__input"
                              value={slot.workspaceName}
                              onChange={(event) => updateSlotDraft(setSlotDrafts, slot.slotId, { workspaceName: event.target.value })}
                            />
                          </label>
                          <label className="settings-field">
                            <span className="settings-field__label">Discord channel ID</span>
                            <input
                              className="settings-field__input"
                              value={slot.channelId}
                              onChange={(event) => updateSlotDraft(setSlotDrafts, slot.slotId, { channelId: event.target.value })}
                            />
                          </label>
                          <label className="settings-field">
                            <span className="settings-field__label">Working directory</span>
                            <input
                              className="settings-field__input"
                              value={slot.cwd}
                              onChange={(event) => updateSlotDraft(setSlotDrafts, slot.slotId, { cwd: event.target.value })}
                            />
                          </label>
                        </div>
                      </div>
                    ))}
                </div>
              </section>
            </div>

            <footer className="settings-screen__footer">
              {settingsError ? <div className="settings-screen__error">{settingsError}</div> : <div />}
              <div className="settings-screen__actions">
                <button className="action-button" onClick={closeSettings} disabled={isSavingSettings}>
                  Cancel
                </button>
                <button className="action-button" onClick={() => void saveSettings()} disabled={isSavingSettings}>
                  Save settings
                </button>
              </div>
            </footer>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function createSettingsDraft(defaultWorkspaceCwd: string, bridgeSettings: BridgeSettings): SettingsDraft {
  return {
    defaultWorkspaceCwd,
    autoScreenshotOnReply: bridgeSettings.autoScreenshotOnReply,
    softTimeoutMs: String(bridgeSettings.softTimeoutMs),
    hardTimeoutMs: String(bridgeSettings.hardTimeoutMs),
    bridgeCols: String(bridgeSettings.bridgeDimensions.cols),
    bridgeRows: String(bridgeSettings.bridgeDimensions.rows)
  };
}

function upsertSession(current: TerminalSessionSummary[], next: TerminalSessionSummary): TerminalSessionSummary[] {
  const existingById = current.findIndex((session) => session.id === next.id);
  if (existingById !== -1) {
    const updated = [...current];
    updated[existingById] = next;
    return updated;
  }

  if (next.slotId) {
    const existingBySlot = current.findIndex((session) => session.slotId === next.slotId);
    if (existingBySlot !== -1) {
      const updated = [...current];
      updated[existingBySlot] = next;
      return updated;
    }
  }

  return [...current, next];
}

function getPaneStatus(session: TerminalSessionSummary | null): { label: string; className: string } {
  if (!session) {
    return {
      label: 'OFF',
      className: 'terminal-tile__status terminal-tile__status--exit'
    };
  }

  if (session.status === 'exited') {
    return {
      label: 'EXIT',
      className: 'terminal-tile__status terminal-tile__status--exit'
    };
  }

  if (session.inputLocked) {
    return {
      label: 'BUSY',
      className: 'terminal-tile__status terminal-tile__status--busy'
    };
  }

  return {
    label: 'LIVE',
    className: 'terminal-tile__status terminal-tile__status--live'
  };
}

function updateSlotDraft(
  setSlotDrafts: Dispatch<SetStateAction<TerminalSlotSettings[]>>,
  slotId: TerminalSlotId,
  update: Partial<TerminalSlotSettings>
) {
  setSlotDrafts((current) => current.map((slot) => (slot.slotId === slotId ? { ...slot, ...update } : slot)));
}

function findSlotName(slots: TerminalSlotSettings[], slotId: TerminalSlotId | undefined): string {
  if (!slotId) {
    return 'terminal';
  }

  return slots.find((slot) => slot.slotId === slotId)?.workspaceName ?? `terminal-${slotId}`;
}
