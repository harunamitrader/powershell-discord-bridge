import { useEffect, useMemo, useRef, useState, type Dispatch, type KeyboardEvent as ReactKeyboardEvent, type SetStateAction } from 'react';
import type {
  AppLogEntry,
  BridgeReplyFormat,
  BootstrapState,
  BridgeSettings,
  TerminalSessionSummary,
  TerminalSlotId,
  TerminalSlotSettings
} from '../../shared/terminal';
import { TerminalViewport } from '../components/TerminalViewport';

interface SettingsDraft {
  autoScreenshotOnReply: boolean;
  inflightScreenshotOnRunningRequest: boolean;
  replyFormat: BridgeReplyFormat;
  softTimeoutSeconds: string;
  hardTimeoutSeconds: string;
  hardTimeoutUnlimited: boolean;
  artifactWatchDirectory: string;
  diffAnchorChars: string;
  bridgeCols: string;
  bridgeRows: string;
  inflightScreenshotDelaySeconds: string;
  redrawWaitAfterShrinkMs: string;
  beforeSendRedrawRestoreMs: string;
  afterCompleteRedrawRestoreMs: string;
  beforeSendPostRedrawDelayMs: string;
  preTextInputSnapshotDelayMs: string;
  textSubmitEnterDelayMs: string;
  repeatedControlKeyDelayMs: string;
  completionSettleMs: string;
  completionNoOutputTimeoutMs: string;
  completionPollIntervalMs: string;
  completionStablePollCount: string;
  manualRedrawWaitAfterShrinkMs: string;
  manualRedrawWaitAfterRestoreMs: string;
  liveViewSnapshotDebounceMs: string;
  snapshotMirrorFlushTimeoutMs: string;
  windowScreenshotCaptureDelayMs: string;
  terminalScreenshotResizeSettleMs: string;
  terminalScreenshotPollIntervalMs: string;
  terminalScreenshotReadyTimeoutMs: string;
  appRestartDelayMs: string;
  attachmentDownloadTimeoutMs: string;
}

type SettingsNumericField =
  | 'diffAnchorChars'
  | 'bridgeCols'
  | 'bridgeRows'
  | 'inflightScreenshotDelaySeconds'
  | 'redrawWaitAfterShrinkMs'
  | 'beforeSendRedrawRestoreMs'
  | 'afterCompleteRedrawRestoreMs'
  | 'beforeSendPostRedrawDelayMs'
  | 'preTextInputSnapshotDelayMs'
  | 'textSubmitEnterDelayMs'
  | 'repeatedControlKeyDelayMs'
  | 'completionSettleMs'
  | 'completionNoOutputTimeoutMs'
  | 'completionPollIntervalMs'
  | 'completionStablePollCount'
  | 'manualRedrawWaitAfterShrinkMs'
  | 'manualRedrawWaitAfterRestoreMs'
  | 'liveViewSnapshotDebounceMs'
  | 'snapshotMirrorFlushTimeoutMs'
  | 'windowScreenshotCaptureDelayMs'
  | 'terminalScreenshotResizeSettleMs'
  | 'terminalScreenshotPollIntervalMs'
  | 'terminalScreenshotReadyTimeoutMs'
  | 'appRestartDelayMs'
  | 'attachmentDownloadTimeoutMs';

const MIN_BRIDGE_COLS = 40;
const MAX_BRIDGE_COLS = 400;
const MIN_BRIDGE_ROWS = 15;
const MAX_BRIDGE_ROWS = 120;
const MIN_SOFT_TIMEOUT_MS = 1000;
const MAX_SOFT_TIMEOUT_MS = 300000;
const MIN_HARD_TIMEOUT_MS = 5000;
const MAX_HARD_TIMEOUT_MS = 7200000;
const MIN_TIMING_DELAY_MS = 0;
const MAX_TIMING_DELAY_MS = 120000;
const MIN_TIMING_COUNT = 1;
const MAX_TIMING_COUNT = 20;
const DEFAULT_HARD_TIMEOUT_MS = 7200000;
const MIN_SOFT_TIMEOUT_SECONDS = MIN_SOFT_TIMEOUT_MS / 1000;
const MAX_SOFT_TIMEOUT_SECONDS = MAX_SOFT_TIMEOUT_MS / 1000;
const MIN_HARD_TIMEOUT_SECONDS = MIN_HARD_TIMEOUT_MS / 1000;
const MAX_HARD_TIMEOUT_SECONDS = MAX_HARD_TIMEOUT_MS / 1000;
const DEFAULT_HARD_TIMEOUT_SECONDS = DEFAULT_HARD_TIMEOUT_MS / 1000;
const MIN_INFLIGHT_SCREENSHOT_DELAY_SECONDS = MIN_TIMING_DELAY_MS / 1000;
const MAX_INFLIGHT_SCREENSHOT_DELAY_SECONDS = MAX_TIMING_DELAY_MS / 1000;
const MIN_DIFF_ANCHOR_CHARS = 50;
const MAX_DIFF_ANCHOR_CHARS = 5000;
const MAX_RENDERED_APP_LOGS = 2000;

export function App() {
  const [bootstrapState, setBootstrapState] = useState<BootstrapState | null>(null);
  const [sessions, setSessions] = useState<TerminalSessionSummary[]>([]);
  const [slotSettings, setSlotSettings] = useState<TerminalSlotSettings[]>([]);
  const [appLogs, setAppLogs] = useState<AppLogEntry[]>([]);
  const [logsOpen, setLogsOpen] = useState(false);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [bridgeSettings, setBridgeSettings] = useState<BridgeSettings>({
    autoScreenshotOnReply: true,
    inflightScreenshotOnRunningRequest: true,
    replyFormat: 'command',
    softTimeoutMs: 300000,
    hardTimeoutMs: null,
    diffAnchorChars: 300,
    bridgeDimensions: {
      cols: 100,
      rows: 50
    },
    artifactPublish: {
      watchDirectory: '',
      channelId: ''
    },
    timing: {
      inflightScreenshotDelayMs: 10000,
      redrawWaitAfterShrinkMs: 500,
      beforeSendRedrawRestoreMs: 1500,
      afterCompleteRedrawRestoreMs: 1000,
      beforeSendPostRedrawDelayMs: 500,
      preTextInputSnapshotDelayMs: 500,
      textSubmitEnterDelayMs: 500,
      repeatedControlKeyDelayMs: 100,
      completionSettleMs: 2000,
      completionNoOutputTimeoutMs: 3000,
      completionPollIntervalMs: 500,
      completionStablePollCount: 3,
      manualRedrawWaitAfterShrinkMs: 150,
      manualRedrawWaitAfterRestoreMs: 250,
      liveViewSnapshotDebounceMs: 120,
      snapshotMirrorFlushTimeoutMs: 2000,
      windowScreenshotCaptureDelayMs: 100,
      terminalScreenshotResizeSettleMs: 120,
      terminalScreenshotPollIntervalMs: 50,
      terminalScreenshotReadyTimeoutMs: 10000,
      appRestartDelayMs: 500,
      attachmentDownloadTimeoutMs: 30000
    }
  });
  const [settingsDraft, setSettingsDraft] = useState<SettingsDraft>({
    autoScreenshotOnReply: true,
    inflightScreenshotOnRunningRequest: true,
    replyFormat: 'command',
    softTimeoutSeconds: '300',
    hardTimeoutSeconds: String(DEFAULT_HARD_TIMEOUT_SECONDS),
    hardTimeoutUnlimited: true,
    artifactWatchDirectory: '',
    diffAnchorChars: '300',
    bridgeCols: '100',
    bridgeRows: '50',
    inflightScreenshotDelaySeconds: '10',
    redrawWaitAfterShrinkMs: '500',
    beforeSendRedrawRestoreMs: '1500',
    afterCompleteRedrawRestoreMs: '1000',
    beforeSendPostRedrawDelayMs: '500',
    preTextInputSnapshotDelayMs: '500',
    textSubmitEnterDelayMs: '500',
    repeatedControlKeyDelayMs: '100',
    completionSettleMs: '2000',
    completionNoOutputTimeoutMs: '3000',
    completionPollIntervalMs: '500',
    completionStablePollCount: '3',
    manualRedrawWaitAfterShrinkMs: '150',
    manualRedrawWaitAfterRestoreMs: '250',
    liveViewSnapshotDebounceMs: '120',
    snapshotMirrorFlushTimeoutMs: '2000',
    windowScreenshotCaptureDelayMs: '100',
    terminalScreenshotResizeSettleMs: '120',
    terminalScreenshotPollIntervalMs: '50',
    terminalScreenshotReadyTimeoutMs: '10000',
    appRestartDelayMs: '500',
    attachmentDownloadTimeoutMs: '30000'
  });
  const [slotDrafts, setSlotDrafts] = useState<TerminalSlotSettings[]>([]);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [isSavingSettings, setIsSavingSettings] = useState(false);
  const [restartingSlotId, setRestartingSlotId] = useState<TerminalSlotId | null>(null);
  const [redrawingSlotId, setRedrawingSlotId] = useState<TerminalSlotId | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [settingsError, setSettingsError] = useState<string | null>(null);
  const [renamingSessionId, setRenamingSessionId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState('');
  const activeSessionIdRef = useRef<string | null>(null);
  const snapshotPublishTimerRef = useRef<number | null>(null);
  const appLogViewportRef = useRef<HTMLDivElement | null>(null);

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
    const unsubscribeActivated = window.terminalApp.onSessionActivated(({ sessionId }) => {
      setActiveSessionId(sessionId);
    });

    const unsubscribeData = window.terminalApp.onSessionData((_event) => {
      scheduleViewSnapshotPublish();
    });
    const unsubscribeAppLogEntry = window.terminalApp.onAppLogEntry((entry) => {
      setAppLogs((current) => appendAppLogEntry(current, entry));
    });

    void (async () => {
      const state = await window.terminalApp.bootstrap();
      setBootstrapState(state);
      setSessions(state.sessions);
      setSlotSettings(state.terminalSlots);
      setAppLogs(state.appLogs);
      setBridgeSettings(state.bridgeSettings);
      setSettingsDraft(createSettingsDraft(state.bridgeSettings));
      setSlotDrafts(state.terminalSlots);
      setActiveSessionId(state.sessions[0]?.id ?? null);
    })();

    return () => {
      unsubscribeUpdated();
      unsubscribeExit();
      unsubscribeActivated();
      unsubscribeData();
      unsubscribeAppLogEntry();
      if (snapshotPublishTimerRef.current !== null) {
        window.clearTimeout(snapshotPublishTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (!logsOpen || !appLogViewportRef.current) {
      return;
    }

    appLogViewportRef.current.scrollTop = appLogViewportRef.current.scrollHeight;
  }, [logsOpen, appLogs]);

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
  const appLogText = useMemo(() => appLogs.map((entry) => entry.text).join(''), [appLogs]);

  function scheduleViewSnapshotPublish() {
    if (snapshotPublishTimerRef.current !== null) {
      window.clearTimeout(snapshotPublishTimerRef.current);
    }

    snapshotPublishTimerRef.current = window.setTimeout(() => {
      snapshotPublishTimerRef.current = null;
      void window.terminalApp.publishLiveViewSnapshot({
        activeSessionId: activeSessionIdRef.current
      });
    }, bridgeSettings.timing.liveViewSnapshotDebounceMs);
  }

  function openSettings() {
    setLogsOpen(false);
    setSettingsError(null);
    setSettingsDraft(createSettingsDraft(bridgeSettings));
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

  function openLogs() {
    setSettingsOpen(false);
    setLogsOpen(true);
  }

  function closeLogs() {
    setLogsOpen(false);
  }

  async function saveSettings() {
    const softTimeoutSeconds = parseBoundedInteger(settingsDraft.softTimeoutSeconds, MIN_SOFT_TIMEOUT_SECONDS, MAX_SOFT_TIMEOUT_SECONDS);
    const softTimeoutMs = softTimeoutSeconds * 1000;
    const hardTimeoutSeconds = settingsDraft.hardTimeoutUnlimited
      ? null
      : parseBoundedInteger(settingsDraft.hardTimeoutSeconds, MIN_HARD_TIMEOUT_SECONDS, MAX_HARD_TIMEOUT_SECONDS);
    const hardTimeoutMs = hardTimeoutSeconds === null ? null : hardTimeoutSeconds * 1000;
    const diffAnchorChars = parseBoundedInteger(settingsDraft.diffAnchorChars, MIN_DIFF_ANCHOR_CHARS, MAX_DIFF_ANCHOR_CHARS);
    const cols = parseBoundedInteger(settingsDraft.bridgeCols, MIN_BRIDGE_COLS, MAX_BRIDGE_COLS);
    const rows = parseBoundedInteger(settingsDraft.bridgeRows, MIN_BRIDGE_ROWS, MAX_BRIDGE_ROWS);
    const inflightScreenshotDelaySeconds = parseBoundedInteger(
      settingsDraft.inflightScreenshotDelaySeconds,
      MIN_INFLIGHT_SCREENSHOT_DELAY_SECONDS,
      MAX_INFLIGHT_SCREENSHOT_DELAY_SECONDS
    );
    const inflightScreenshotDelayMs = inflightScreenshotDelaySeconds * 1000;
    const artifactWatchDirectory = settingsDraft.artifactWatchDirectory.trim();
    const redrawWaitAfterShrinkMs = parseBoundedInteger(settingsDraft.redrawWaitAfterShrinkMs, MIN_TIMING_DELAY_MS, MAX_TIMING_DELAY_MS);
    const beforeSendRedrawRestoreMs = parseBoundedInteger(
      settingsDraft.beforeSendRedrawRestoreMs,
      MIN_TIMING_DELAY_MS,
      MAX_TIMING_DELAY_MS
    );
    const afterCompleteRedrawRestoreMs = parseBoundedInteger(
      settingsDraft.afterCompleteRedrawRestoreMs,
      MIN_TIMING_DELAY_MS,
      MAX_TIMING_DELAY_MS
    );
    const beforeSendPostRedrawDelayMs = parseBoundedInteger(
      settingsDraft.beforeSendPostRedrawDelayMs,
      MIN_TIMING_DELAY_MS,
      MAX_TIMING_DELAY_MS
    );
    const preTextInputSnapshotDelayMs = parseBoundedInteger(
      settingsDraft.preTextInputSnapshotDelayMs,
      MIN_TIMING_DELAY_MS,
      MAX_TIMING_DELAY_MS
    );
    const textSubmitEnterDelayMs = parseBoundedInteger(
      settingsDraft.textSubmitEnterDelayMs,
      MIN_TIMING_DELAY_MS,
      MAX_TIMING_DELAY_MS
    );
    const repeatedControlKeyDelayMs = parseBoundedInteger(
      settingsDraft.repeatedControlKeyDelayMs,
      MIN_TIMING_DELAY_MS,
      MAX_TIMING_DELAY_MS
    );
    const completionSettleMs = parseBoundedInteger(settingsDraft.completionSettleMs, MIN_TIMING_DELAY_MS, MAX_TIMING_DELAY_MS);
    const completionNoOutputTimeoutMs = parseBoundedInteger(
      settingsDraft.completionNoOutputTimeoutMs,
      MIN_TIMING_DELAY_MS,
      MAX_TIMING_DELAY_MS
    );
    const completionPollIntervalMs = parseBoundedInteger(
      settingsDraft.completionPollIntervalMs,
      MIN_TIMING_DELAY_MS,
      MAX_TIMING_DELAY_MS
    );
    const completionStablePollCount = parseBoundedInteger(
      settingsDraft.completionStablePollCount,
      MIN_TIMING_COUNT,
      MAX_TIMING_COUNT
    );
    const manualRedrawWaitAfterShrinkMs = parseBoundedInteger(
      settingsDraft.manualRedrawWaitAfterShrinkMs,
      MIN_TIMING_DELAY_MS,
      MAX_TIMING_DELAY_MS
    );
    const manualRedrawWaitAfterRestoreMs = parseBoundedInteger(
      settingsDraft.manualRedrawWaitAfterRestoreMs,
      MIN_TIMING_DELAY_MS,
      MAX_TIMING_DELAY_MS
    );
    const liveViewSnapshotDebounceMs = parseBoundedInteger(
      settingsDraft.liveViewSnapshotDebounceMs,
      MIN_TIMING_DELAY_MS,
      MAX_TIMING_DELAY_MS
    );
    const snapshotMirrorFlushTimeoutMs = parseBoundedInteger(
      settingsDraft.snapshotMirrorFlushTimeoutMs,
      MIN_TIMING_DELAY_MS,
      MAX_TIMING_DELAY_MS
    );
    const windowScreenshotCaptureDelayMs = parseBoundedInteger(
      settingsDraft.windowScreenshotCaptureDelayMs,
      MIN_TIMING_DELAY_MS,
      MAX_TIMING_DELAY_MS
    );
    const terminalScreenshotResizeSettleMs = parseBoundedInteger(
      settingsDraft.terminalScreenshotResizeSettleMs,
      MIN_TIMING_DELAY_MS,
      MAX_TIMING_DELAY_MS
    );
    const terminalScreenshotPollIntervalMs = parseBoundedInteger(
      settingsDraft.terminalScreenshotPollIntervalMs,
      MIN_TIMING_DELAY_MS,
      MAX_TIMING_DELAY_MS
    );
    const terminalScreenshotReadyTimeoutMs = parseBoundedInteger(
      settingsDraft.terminalScreenshotReadyTimeoutMs,
      MIN_TIMING_DELAY_MS,
      MAX_TIMING_DELAY_MS
    );
    const appRestartDelayMs = parseBoundedInteger(
      settingsDraft.appRestartDelayMs,
      MIN_TIMING_DELAY_MS,
      MAX_TIMING_DELAY_MS
    );
    const attachmentDownloadTimeoutMs = parseBoundedInteger(
      settingsDraft.attachmentDownloadTimeoutMs,
      MIN_TIMING_DELAY_MS,
      MAX_TIMING_DELAY_MS
    );

    if (artifactWatchDirectory.length === 0) {
      setSettingsError('Enter an artifact publish folder.');
      return;
    }

    if (
      !Number.isFinite(softTimeoutSeconds) ||
      (!settingsDraft.hardTimeoutUnlimited && !Number.isFinite(hardTimeoutSeconds)) ||
      !Number.isFinite(diffAnchorChars) ||
      !Number.isFinite(cols) ||
      !Number.isFinite(rows) ||
      !Number.isFinite(inflightScreenshotDelaySeconds) ||
      !Number.isFinite(redrawWaitAfterShrinkMs) ||
      !Number.isFinite(beforeSendRedrawRestoreMs) ||
      !Number.isFinite(afterCompleteRedrawRestoreMs) ||
      !Number.isFinite(beforeSendPostRedrawDelayMs) ||
      !Number.isFinite(preTextInputSnapshotDelayMs) ||
      !Number.isFinite(textSubmitEnterDelayMs) ||
      !Number.isFinite(repeatedControlKeyDelayMs) ||
      !Number.isFinite(completionSettleMs) ||
      !Number.isFinite(completionNoOutputTimeoutMs) ||
      !Number.isFinite(completionPollIntervalMs) ||
      !Number.isFinite(completionStablePollCount) ||
      !Number.isFinite(manualRedrawWaitAfterShrinkMs) ||
      !Number.isFinite(manualRedrawWaitAfterRestoreMs) ||
      !Number.isFinite(liveViewSnapshotDebounceMs) ||
      !Number.isFinite(snapshotMirrorFlushTimeoutMs) ||
      !Number.isFinite(windowScreenshotCaptureDelayMs) ||
      !Number.isFinite(terminalScreenshotResizeSettleMs) ||
      !Number.isFinite(terminalScreenshotPollIntervalMs) ||
      !Number.isFinite(terminalScreenshotReadyTimeoutMs) ||
      !Number.isFinite(appRestartDelayMs) ||
      !Number.isFinite(attachmentDownloadTimeoutMs)
    ) {
      setSettingsError('Check the numeric settings.');
      return;
    }

    setIsSavingSettings(true);
    setSettingsError(null);
    setFeedback(null);

    try {
      const updatedBridgeSettings = await window.terminalApp.updateBridgeSettings({
        autoScreenshotOnReply: settingsDraft.autoScreenshotOnReply,
        inflightScreenshotOnRunningRequest: settingsDraft.inflightScreenshotOnRunningRequest,
        replyFormat: settingsDraft.replyFormat,
        softTimeoutMs,
        hardTimeoutMs,
        diffAnchorChars,
        artifactPublish: {
          watchDirectory: artifactWatchDirectory
        },
        bridgeDimensions: {
          cols,
          rows
        },
        timing: {
          inflightScreenshotDelayMs,
          redrawWaitAfterShrinkMs,
          beforeSendRedrawRestoreMs,
          afterCompleteRedrawRestoreMs,
          beforeSendPostRedrawDelayMs,
          preTextInputSnapshotDelayMs,
          textSubmitEnterDelayMs,
          repeatedControlKeyDelayMs,
          completionSettleMs,
          completionNoOutputTimeoutMs,
          completionPollIntervalMs,
          completionStablePollCount,
          manualRedrawWaitAfterShrinkMs,
          manualRedrawWaitAfterRestoreMs,
          liveViewSnapshotDebounceMs,
          snapshotMirrorFlushTimeoutMs,
          windowScreenshotCaptureDelayMs,
          terminalScreenshotResizeSettleMs,
          terminalScreenshotPollIntervalMs,
          terminalScreenshotReadyTimeoutMs,
          appRestartDelayMs,
          attachmentDownloadTimeoutMs
        }
      });
      setBridgeSettings(updatedBridgeSettings);

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
              bridgeSettings: updatedBridgeSettings,
              terminalSlots: updatedSlots
            }
          : current
      );
      setSettingsOpen(false);
      setFeedback('Settings saved.');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setSettingsError(message);
    } finally {
      setIsSavingSettings(false);
    }
  }

  async function restartSlot(slotId: TerminalSlotId) {
    const slotName = findSlotName(slotSettings, slotId);
    if (!window.confirm(`${slotName} を再起動しますか？\n現在の PowerShell セッションは終了して、新しいセッションに置き換わります。`)) {
      return;
    }

    setRestartingSlotId(slotId);
    setFeedback(null);
    try {
      const session = await window.terminalApp.restartTerminalSlot(slotId);
      setSessions((current) => upsertSession(current, session));
      setActiveSessionId(session.id);
      setFeedback(`${slotName} を再起動しました。`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setFeedback(`再起動に失敗しました: ${message}`);
    } finally {
      setRestartingSlotId(null);
    }
  }

  async function redrawSlot(slotId: TerminalSlotId, session: TerminalSessionSummary) {
    setRedrawingSlotId(slotId);
    setFeedback(null);
    try {
      await window.terminalApp.redrawJiggle({
        sessionId: session.id
      });
      scheduleViewSnapshotPublish();
      setFeedback(`${findSlotName(slotSettings, slotId)} を再描画しました。`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setFeedback(`再描画に失敗しました: ${message}`);
    } finally {
      setRedrawingSlotId(null);
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
            {feedback ? <span className="titlebar__feedback">{feedback}</span> : null}
          </div>
          <div className="titlebar__actions">
            <button className={logsOpen ? 'action-button action-button--selected' : 'action-button'} onClick={openLogs}>
              Logs
            </button>
            <button className="action-button" onClick={openSettings}>
              Settings
            </button>
          </div>
        </header>

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
                        <button className="action-button action-button--compact" onClick={() => void submitRenameSession(session, renameDraft)}>
                          Save
                        </button>
                        <button className="action-button action-button--compact" onClick={cancelRenameSession}>
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
                      className="action-button action-button--compact"
                      onClick={() => {
                        if (session) {
                          void redrawSlot(slot.slotId, session);
                        }
                      }}
                      disabled={!session || redrawingSlotId === slot.slotId || restartingSlotId === slot.slotId}
                    >
                      Redraw
                    </button>
                    <button
                      className="action-button action-button--compact"
                      onClick={() => void restartSlot(slot.slotId)}
                      disabled={restartingSlotId === slot.slotId || redrawingSlotId === slot.slotId}
                    >
                      Restart
                    </button>
                  </div>
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

      {logsOpen ? (
        <div className="settings-screen" role="dialog" aria-modal="true">
          <div className="log-screen__panel">
            <header className="settings-screen__header">
              <div>
                <div className="settings-screen__title">Logs</div>
                <div className="settings-screen__subtitle">Main process stdout, stderr, and terminal input/action logs.</div>
              </div>
              <button className="action-button" onClick={closeLogs}>
                Close
              </button>
            </header>
            <div ref={appLogViewportRef} className="app-log-panel__viewport app-log-panel__viewport--overlay">
              {appLogText.length > 0 ? (
                <pre className="app-log-panel__content">{appLogText}</pre>
              ) : (
                <div className="app-log-panel__empty">No logs yet.</div>
              )}
            </div>
          </div>
        </div>
      ) : null}

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
                <div className="settings-form">
                  <div className="settings-group">
                    <div className="settings-group__header">
                      <h3 className="settings-group__title">Replies and visibility</h3>
                      <p className="settings-group__description">Control how Discord replies, interim screenshots, and diff extraction are presented.</p>
                    </div>
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
                        <div className="settings-toggle__description">Attach an app-window screenshot after each completed Discord reply.</div>
                      </div>
                    </label>
                    <label className="settings-toggle">
                      <input
                        type="checkbox"
                        checked={settingsDraft.inflightScreenshotOnRunningRequest}
                        onChange={(event) =>
                          setSettingsDraft((current) => ({
                            ...current,
                            inflightScreenshotOnRunningRequest: event.target.checked
                          }))
                        }
                      />
                      <div className="settings-toggle__body">
                        <div className="settings-toggle__title">Delayed inflight terminal screenshot</div>
                        <div className="settings-toggle__description">
                          Send one interim terminal screenshot when a text or control request is still running after the configured delay.
                        </div>
                      </div>
                    </label>
                    <div className="settings-grid settings-grid--compact">
                      <label className="settings-field">
                        <span className="settings-field__label">Discord reply format</span>
                        <select
                          className="settings-field__input"
                          value={settingsDraft.replyFormat}
                          onChange={(event) =>
                            setSettingsDraft((current) => ({
                              ...current,
                              replyFormat: event.target.value as BridgeReplyFormat
                            }))
                          }
                        >
                          <option value="command">Code block</option>
                          <option value="plain-text">Plain text</option>
                        </select>
                      </label>
                      <label className="settings-field">
                        <span className="settings-field__label">{`Inflight screenshot delay (s, ${MIN_INFLIGHT_SCREENSHOT_DELAY_SECONDS}-${MAX_INFLIGHT_SCREENSHOT_DELAY_SECONDS})`}</span>
                        <input
                          className="settings-field__input"
                          type="number"
                          min={MIN_INFLIGHT_SCREENSHOT_DELAY_SECONDS}
                          max={MAX_INFLIGHT_SCREENSHOT_DELAY_SECONDS}
                          step={1}
                          value={settingsDraft.inflightScreenshotDelaySeconds}
                          onChange={(event) =>
                            updateBoundedIntegerDraft(
                              setSettingsDraft,
                              'inflightScreenshotDelaySeconds',
                              event.target.value,
                              MIN_INFLIGHT_SCREENSHOT_DELAY_SECONDS,
                              MAX_INFLIGHT_SCREENSHOT_DELAY_SECONDS
                            )
                          }
                          onBlur={() =>
                            clampBoundedIntegerDraft(
                              setSettingsDraft,
                              'inflightScreenshotDelaySeconds',
                              settingsDraft.inflightScreenshotDelaySeconds,
                              MIN_INFLIGHT_SCREENSHOT_DELAY_SECONDS,
                              MAX_INFLIGHT_SCREENSHOT_DELAY_SECONDS
                            )
                          }
                        />
                      </label>
                      <label className="settings-field">
                        <span className="settings-field__label">{`Screen diff anchor chars (${MIN_DIFF_ANCHOR_CHARS}-${MAX_DIFF_ANCHOR_CHARS})`}</span>
                        <input
                          className="settings-field__input"
                          type="number"
                          min={MIN_DIFF_ANCHOR_CHARS}
                          max={MAX_DIFF_ANCHOR_CHARS}
                          step={1}
                          value={settingsDraft.diffAnchorChars}
                          onChange={(event) =>
                            updateBoundedIntegerDraft(
                              setSettingsDraft,
                              'diffAnchorChars',
                              event.target.value,
                              MIN_DIFF_ANCHOR_CHARS,
                              MAX_DIFF_ANCHOR_CHARS
                            )
                          }
                          onBlur={() =>
                            clampBoundedIntegerDraft(
                              setSettingsDraft,
                              'diffAnchorChars',
                              settingsDraft.diffAnchorChars,
                              MIN_DIFF_ANCHOR_CHARS,
                              MAX_DIFF_ANCHOR_CHARS
                            )
                          }
                        />
                      </label>
                    </div>
                  </div>

                  <div className="settings-group">
                    <div className="settings-group__header">
                      <h3 className="settings-group__title">Session limits</h3>
                      <p className="settings-group__description">Tune how long the bridge waits before considering a request stalled or timed out.</p>
                    </div>
                    <div className="settings-grid settings-grid--compact">
                      <label className="settings-field">
                        <span className="settings-field__label">Soft timeout (s)</span>
                        <input
                          className="settings-field__input"
                          type="number"
                          min={MIN_SOFT_TIMEOUT_SECONDS}
                          max={MAX_SOFT_TIMEOUT_SECONDS}
                          step={1}
                          value={settingsDraft.softTimeoutSeconds}
                          onChange={(event) =>
                            setSettingsDraft((current) => ({
                              ...current,
                              softTimeoutSeconds: event.target.value
                            }))
                          }
                        />
                      </label>
                      <label className="settings-field">
                        <span className="settings-field__label">Hard timeout (s)</span>
                        <input
                          className="settings-field__input"
                          type="number"
                          min={MIN_HARD_TIMEOUT_SECONDS}
                          max={MAX_HARD_TIMEOUT_SECONDS}
                          step={1}
                          value={settingsDraft.hardTimeoutSeconds}
                          disabled={settingsDraft.hardTimeoutUnlimited}
                          onChange={(event) =>
                            setSettingsDraft((current) => ({
                              ...current,
                              hardTimeoutSeconds: event.target.value
                            }))
                          }
                        />
                      </label>
                    </div>
                    <label className="settings-toggle">
                      <input
                        type="checkbox"
                        checked={settingsDraft.hardTimeoutUnlimited}
                        onChange={(event) =>
                          setSettingsDraft((current) => ({
                            ...current,
                            hardTimeoutUnlimited: event.target.checked
                          }))
                        }
                      />
                      <div className="settings-toggle__body">
                        <span className="settings-toggle__title">Unlimited hard timeout</span>
                        <span className="settings-toggle__description">Disable the forced timeout and wait until completion or manual stop.</span>
                      </div>
                    </label>
                  </div>

                  <div className="settings-group">
                    <div className="settings-group__header">
                      <h3 className="settings-group__title">Layout and artifact publishing</h3>
                      <p className="settings-group__description">Set the fixed bridge size and the shared folder and channel used for artifact uploads.</p>
                    </div>
                    <div className="settings-grid settings-grid--compact">
                      <label className="settings-field">
                        <span className="settings-field__label">{`Bridge cols (${MIN_BRIDGE_COLS}-${MAX_BRIDGE_COLS})`}</span>
                        <input
                          className="settings-field__input"
                          type="number"
                          min={MIN_BRIDGE_COLS}
                          max={MAX_BRIDGE_COLS}
                          step={1}
                          value={settingsDraft.bridgeCols}
                          onChange={(event) =>
                            updateBoundedIntegerDraft(setSettingsDraft, 'bridgeCols', event.target.value, MIN_BRIDGE_COLS, MAX_BRIDGE_COLS)
                          }
                          onBlur={() =>
                            clampBoundedIntegerDraft(setSettingsDraft, 'bridgeCols', settingsDraft.bridgeCols, MIN_BRIDGE_COLS, MAX_BRIDGE_COLS)
                          }
                        />
                      </label>
                      <label className="settings-field">
                        <span className="settings-field__label">{`Bridge rows (${MIN_BRIDGE_ROWS}-${MAX_BRIDGE_ROWS})`}</span>
                        <input
                          className="settings-field__input"
                          type="number"
                          min={MIN_BRIDGE_ROWS}
                          max={MAX_BRIDGE_ROWS}
                          step={1}
                          value={settingsDraft.bridgeRows}
                          onChange={(event) =>
                            updateBoundedIntegerDraft(setSettingsDraft, 'bridgeRows', event.target.value, MIN_BRIDGE_ROWS, MAX_BRIDGE_ROWS)
                          }
                          onBlur={() =>
                            clampBoundedIntegerDraft(setSettingsDraft, 'bridgeRows', settingsDraft.bridgeRows, MIN_BRIDGE_ROWS, MAX_BRIDGE_ROWS)
                          }
                        />
                      </label>
                      <label className="settings-field">
                        <span className="settings-field__label">Artifact publish folder</span>
                        <input
                          className="settings-field__input"
                          type="text"
                          value={settingsDraft.artifactWatchDirectory}
                          onChange={(event) =>
                            setSettingsDraft((current) => ({
                              ...current,
                              artifactWatchDirectory: event.target.value
                            }))
                          }
                          placeholder="C:\\path\\to\\discord-publish"
                        />
                      </label>
                      <label className="settings-field">
                        <span className="settings-field__label">Artifact channel</span>
                        <input
                          className="settings-field__input"
                          type="text"
                          value={bridgeSettings.artifactPublish.channelId || 'Auto-create on Discord connect'}
                          readOnly
                        />
                      </label>
                    </div>
                  </div>

                  <div className="settings-group">
                    <div className="settings-group__header">
                      <h3 className="settings-group__title">Input and redraw timing</h3>
                      <p className="settings-group__description">Adjust waits around redraw, snapshots, text submission, and repeated control-key input.</p>
                    </div>
                    <div className="settings-grid">
                      <label className="settings-field">
                        <span className="settings-field__label">{`Redraw shrink wait (ms, ${MIN_TIMING_DELAY_MS}-${MAX_TIMING_DELAY_MS})`}</span>
                        <input
                          className="settings-field__input"
                          type="number"
                          min={MIN_TIMING_DELAY_MS}
                          max={MAX_TIMING_DELAY_MS}
                          step={1}
                          value={settingsDraft.redrawWaitAfterShrinkMs}
                          onChange={(event) =>
                            updateBoundedIntegerDraft(setSettingsDraft, 'redrawWaitAfterShrinkMs', event.target.value, MIN_TIMING_DELAY_MS, MAX_TIMING_DELAY_MS)
                          }
                          onBlur={() =>
                            clampBoundedIntegerDraft(
                              setSettingsDraft,
                              'redrawWaitAfterShrinkMs',
                              settingsDraft.redrawWaitAfterShrinkMs,
                              MIN_TIMING_DELAY_MS,
                              MAX_TIMING_DELAY_MS
                            )
                          }
                        />
                      </label>
                      <label className="settings-field">
                        <span className="settings-field__label">{`Before-send redraw restore (ms, ${MIN_TIMING_DELAY_MS}-${MAX_TIMING_DELAY_MS})`}</span>
                        <input
                          className="settings-field__input"
                          type="number"
                          min={MIN_TIMING_DELAY_MS}
                          max={MAX_TIMING_DELAY_MS}
                          step={1}
                          value={settingsDraft.beforeSendRedrawRestoreMs}
                          onChange={(event) =>
                            updateBoundedIntegerDraft(setSettingsDraft, 'beforeSendRedrawRestoreMs', event.target.value, MIN_TIMING_DELAY_MS, MAX_TIMING_DELAY_MS)
                          }
                          onBlur={() =>
                            clampBoundedIntegerDraft(
                              setSettingsDraft,
                              'beforeSendRedrawRestoreMs',
                              settingsDraft.beforeSendRedrawRestoreMs,
                              MIN_TIMING_DELAY_MS,
                              MAX_TIMING_DELAY_MS
                            )
                          }
                        />
                      </label>
                      <label className="settings-field">
                        <span className="settings-field__label">{`Before-send post-redraw wait (ms, ${MIN_TIMING_DELAY_MS}-${MAX_TIMING_DELAY_MS})`}</span>
                        <input
                          className="settings-field__input"
                          type="number"
                          min={MIN_TIMING_DELAY_MS}
                          max={MAX_TIMING_DELAY_MS}
                          step={1}
                          value={settingsDraft.beforeSendPostRedrawDelayMs}
                          onChange={(event) =>
                            updateBoundedIntegerDraft(
                              setSettingsDraft,
                              'beforeSendPostRedrawDelayMs',
                              event.target.value,
                              MIN_TIMING_DELAY_MS,
                              MAX_TIMING_DELAY_MS
                            )
                          }
                          onBlur={() =>
                            clampBoundedIntegerDraft(
                              setSettingsDraft,
                              'beforeSendPostRedrawDelayMs',
                              settingsDraft.beforeSendPostRedrawDelayMs,
                              MIN_TIMING_DELAY_MS,
                              MAX_TIMING_DELAY_MS
                            )
                          }
                        />
                      </label>
                      <label className="settings-field">
                        <span className="settings-field__label">{`Pre-input snapshot wait (ms, ${MIN_TIMING_DELAY_MS}-${MAX_TIMING_DELAY_MS})`}</span>
                        <input
                          className="settings-field__input"
                          type="number"
                          min={MIN_TIMING_DELAY_MS}
                          max={MAX_TIMING_DELAY_MS}
                          step={1}
                          value={settingsDraft.preTextInputSnapshotDelayMs}
                          onChange={(event) =>
                            updateBoundedIntegerDraft(
                              setSettingsDraft,
                              'preTextInputSnapshotDelayMs',
                              event.target.value,
                              MIN_TIMING_DELAY_MS,
                              MAX_TIMING_DELAY_MS
                            )
                          }
                          onBlur={() =>
                            clampBoundedIntegerDraft(
                              setSettingsDraft,
                              'preTextInputSnapshotDelayMs',
                              settingsDraft.preTextInputSnapshotDelayMs,
                              MIN_TIMING_DELAY_MS,
                              MAX_TIMING_DELAY_MS
                            )
                          }
                        />
                      </label>
                      <label className="settings-field">
                        <span className="settings-field__label">{`Text-to-Enter wait (ms, ${MIN_TIMING_DELAY_MS}-${MAX_TIMING_DELAY_MS})`}</span>
                        <input
                          className="settings-field__input"
                          type="number"
                          min={MIN_TIMING_DELAY_MS}
                          max={MAX_TIMING_DELAY_MS}
                          step={1}
                          value={settingsDraft.textSubmitEnterDelayMs}
                          onChange={(event) =>
                            updateBoundedIntegerDraft(
                              setSettingsDraft,
                              'textSubmitEnterDelayMs',
                              event.target.value,
                              MIN_TIMING_DELAY_MS,
                              MAX_TIMING_DELAY_MS
                            )
                          }
                          onBlur={() =>
                            clampBoundedIntegerDraft(
                              setSettingsDraft,
                              'textSubmitEnterDelayMs',
                              settingsDraft.textSubmitEnterDelayMs,
                              MIN_TIMING_DELAY_MS,
                              MAX_TIMING_DELAY_MS
                            )
                          }
                        />
                      </label>
                      <label className="settings-field">
                        <span className="settings-field__label">{`Repeat key interval (ms, ${MIN_TIMING_DELAY_MS}-${MAX_TIMING_DELAY_MS})`}</span>
                        <input
                          className="settings-field__input"
                          type="number"
                          min={MIN_TIMING_DELAY_MS}
                          max={MAX_TIMING_DELAY_MS}
                          step={1}
                          value={settingsDraft.repeatedControlKeyDelayMs}
                          onChange={(event) =>
                            updateBoundedIntegerDraft(
                              setSettingsDraft,
                              'repeatedControlKeyDelayMs',
                              event.target.value,
                              MIN_TIMING_DELAY_MS,
                              MAX_TIMING_DELAY_MS
                            )
                          }
                          onBlur={() =>
                            clampBoundedIntegerDraft(
                              setSettingsDraft,
                              'repeatedControlKeyDelayMs',
                              settingsDraft.repeatedControlKeyDelayMs,
                              MIN_TIMING_DELAY_MS,
                              MAX_TIMING_DELAY_MS
                            )
                          }
                        />
                      </label>
                      <label className="settings-field">
                        <span className="settings-field__label">{`After-complete redraw restore (ms, ${MIN_TIMING_DELAY_MS}-${MAX_TIMING_DELAY_MS})`}</span>
                        <input
                          className="settings-field__input"
                          type="number"
                          min={MIN_TIMING_DELAY_MS}
                          max={MAX_TIMING_DELAY_MS}
                          step={1}
                          value={settingsDraft.afterCompleteRedrawRestoreMs}
                          onChange={(event) =>
                            updateBoundedIntegerDraft(
                              setSettingsDraft,
                              'afterCompleteRedrawRestoreMs',
                              event.target.value,
                              MIN_TIMING_DELAY_MS,
                              MAX_TIMING_DELAY_MS
                            )
                          }
                          onBlur={() =>
                            clampBoundedIntegerDraft(
                              setSettingsDraft,
                              'afterCompleteRedrawRestoreMs',
                              settingsDraft.afterCompleteRedrawRestoreMs,
                              MIN_TIMING_DELAY_MS,
                              MAX_TIMING_DELAY_MS
                            )
                          }
                        />
                      </label>
                      <label className="settings-field">
                        <span className="settings-field__label">{`Manual redraw shrink wait (ms, ${MIN_TIMING_DELAY_MS}-${MAX_TIMING_DELAY_MS})`}</span>
                        <input
                          className="settings-field__input"
                          type="number"
                          min={MIN_TIMING_DELAY_MS}
                          max={MAX_TIMING_DELAY_MS}
                          step={1}
                          value={settingsDraft.manualRedrawWaitAfterShrinkMs}
                          onChange={(event) =>
                            updateBoundedIntegerDraft(
                              setSettingsDraft,
                              'manualRedrawWaitAfterShrinkMs',
                              event.target.value,
                              MIN_TIMING_DELAY_MS,
                              MAX_TIMING_DELAY_MS
                            )
                          }
                          onBlur={() =>
                            clampBoundedIntegerDraft(
                              setSettingsDraft,
                              'manualRedrawWaitAfterShrinkMs',
                              settingsDraft.manualRedrawWaitAfterShrinkMs,
                              MIN_TIMING_DELAY_MS,
                              MAX_TIMING_DELAY_MS
                            )
                          }
                        />
                      </label>
                      <label className="settings-field">
                        <span className="settings-field__label">{`Manual redraw restore wait (ms, ${MIN_TIMING_DELAY_MS}-${MAX_TIMING_DELAY_MS})`}</span>
                        <input
                          className="settings-field__input"
                          type="number"
                          min={MIN_TIMING_DELAY_MS}
                          max={MAX_TIMING_DELAY_MS}
                          step={1}
                          value={settingsDraft.manualRedrawWaitAfterRestoreMs}
                          onChange={(event) =>
                            updateBoundedIntegerDraft(
                              setSettingsDraft,
                              'manualRedrawWaitAfterRestoreMs',
                              event.target.value,
                              MIN_TIMING_DELAY_MS,
                              MAX_TIMING_DELAY_MS
                            )
                          }
                          onBlur={() =>
                            clampBoundedIntegerDraft(
                              setSettingsDraft,
                              'manualRedrawWaitAfterRestoreMs',
                              settingsDraft.manualRedrawWaitAfterRestoreMs,
                              MIN_TIMING_DELAY_MS,
                              MAX_TIMING_DELAY_MS
                            )
                          }
                        />
                      </label>
                    </div>
                  </div>

                  <div className="settings-group">
                    <div className="settings-group__header">
                      <h3 className="settings-group__title">Completion detection</h3>
                      <p className="settings-group__description">Tune the polling and stabilization rules used to decide when terminal work has finished.</p>
                    </div>
                    <div className="settings-grid settings-grid--compact">
                      <label className="settings-field">
                        <span className="settings-field__label">{`Completion settle (ms, ${MIN_TIMING_DELAY_MS}-${MAX_TIMING_DELAY_MS})`}</span>
                        <input
                          className="settings-field__input"
                          type="number"
                          min={MIN_TIMING_DELAY_MS}
                          max={MAX_TIMING_DELAY_MS}
                          step={1}
                          value={settingsDraft.completionSettleMs}
                          onChange={(event) =>
                            updateBoundedIntegerDraft(setSettingsDraft, 'completionSettleMs', event.target.value, MIN_TIMING_DELAY_MS, MAX_TIMING_DELAY_MS)
                          }
                          onBlur={() =>
                            clampBoundedIntegerDraft(
                              setSettingsDraft,
                              'completionSettleMs',
                              settingsDraft.completionSettleMs,
                              MIN_TIMING_DELAY_MS,
                              MAX_TIMING_DELAY_MS
                            )
                          }
                        />
                      </label>
                      <label className="settings-field">
                        <span className="settings-field__label">{`Completion no-output timeout (ms, ${MIN_TIMING_DELAY_MS}-${MAX_TIMING_DELAY_MS})`}</span>
                        <input
                          className="settings-field__input"
                          type="number"
                          min={MIN_TIMING_DELAY_MS}
                          max={MAX_TIMING_DELAY_MS}
                          step={1}
                          value={settingsDraft.completionNoOutputTimeoutMs}
                          onChange={(event) =>
                            updateBoundedIntegerDraft(
                              setSettingsDraft,
                              'completionNoOutputTimeoutMs',
                              event.target.value,
                              MIN_TIMING_DELAY_MS,
                              MAX_TIMING_DELAY_MS
                            )
                          }
                          onBlur={() =>
                            clampBoundedIntegerDraft(
                              setSettingsDraft,
                              'completionNoOutputTimeoutMs',
                              settingsDraft.completionNoOutputTimeoutMs,
                              MIN_TIMING_DELAY_MS,
                              MAX_TIMING_DELAY_MS
                            )
                          }
                        />
                      </label>
                      <label className="settings-field">
                        <span className="settings-field__label">{`Completion poll interval (ms, ${MIN_TIMING_DELAY_MS}-${MAX_TIMING_DELAY_MS})`}</span>
                        <input
                          className="settings-field__input"
                          type="number"
                          min={MIN_TIMING_DELAY_MS}
                          max={MAX_TIMING_DELAY_MS}
                          step={1}
                          value={settingsDraft.completionPollIntervalMs}
                          onChange={(event) =>
                            updateBoundedIntegerDraft(
                              setSettingsDraft,
                              'completionPollIntervalMs',
                              event.target.value,
                              MIN_TIMING_DELAY_MS,
                              MAX_TIMING_DELAY_MS
                            )
                          }
                          onBlur={() =>
                            clampBoundedIntegerDraft(
                              setSettingsDraft,
                              'completionPollIntervalMs',
                              settingsDraft.completionPollIntervalMs,
                              MIN_TIMING_DELAY_MS,
                              MAX_TIMING_DELAY_MS
                            )
                          }
                        />
                      </label>
                      <label className="settings-field">
                        <span className="settings-field__label">{`Completion stable polls (${MIN_TIMING_COUNT}-${MAX_TIMING_COUNT})`}</span>
                        <input
                          className="settings-field__input"
                          type="number"
                          min={MIN_TIMING_COUNT}
                          max={MAX_TIMING_COUNT}
                          step={1}
                          value={settingsDraft.completionStablePollCount}
                          onChange={(event) =>
                            updateBoundedIntegerDraft(setSettingsDraft, 'completionStablePollCount', event.target.value, MIN_TIMING_COUNT, MAX_TIMING_COUNT)
                          }
                          onBlur={() =>
                            clampBoundedIntegerDraft(
                              setSettingsDraft,
                              'completionStablePollCount',
                              settingsDraft.completionStablePollCount,
                              MIN_TIMING_COUNT,
                              MAX_TIMING_COUNT
                            )
                          }
                        />
                      </label>
                    </div>
                  </div>

                  <div className="settings-group">
                    <div className="settings-group__header">
                      <h3 className="settings-group__title">Live view and capture</h3>
                      <p className="settings-group__description">Configure live snapshot publishing and screenshot capture timings used by the app and bridge.</p>
                    </div>
                    <div className="settings-grid">
                      <label className="settings-field">
                        <span className="settings-field__label">{`Live view publish debounce (ms, ${MIN_TIMING_DELAY_MS}-${MAX_TIMING_DELAY_MS})`}</span>
                        <input
                          className="settings-field__input"
                          type="number"
                          min={MIN_TIMING_DELAY_MS}
                          max={MAX_TIMING_DELAY_MS}
                          step={1}
                          value={settingsDraft.liveViewSnapshotDebounceMs}
                          onChange={(event) =>
                            updateBoundedIntegerDraft(
                              setSettingsDraft,
                              'liveViewSnapshotDebounceMs',
                              event.target.value,
                              MIN_TIMING_DELAY_MS,
                              MAX_TIMING_DELAY_MS
                            )
                          }
                          onBlur={() =>
                            clampBoundedIntegerDraft(
                              setSettingsDraft,
                              'liveViewSnapshotDebounceMs',
                              settingsDraft.liveViewSnapshotDebounceMs,
                              MIN_TIMING_DELAY_MS,
                              MAX_TIMING_DELAY_MS
                            )
                          }
                        />
                      </label>
                      <label className="settings-field">
                        <span className="settings-field__label">{`Snapshot mirror flush timeout (ms, ${MIN_TIMING_DELAY_MS}-${MAX_TIMING_DELAY_MS})`}</span>
                        <input
                          className="settings-field__input"
                          type="number"
                          min={MIN_TIMING_DELAY_MS}
                          max={MAX_TIMING_DELAY_MS}
                          step={1}
                          value={settingsDraft.snapshotMirrorFlushTimeoutMs}
                          onChange={(event) =>
                            updateBoundedIntegerDraft(
                              setSettingsDraft,
                              'snapshotMirrorFlushTimeoutMs',
                              event.target.value,
                              MIN_TIMING_DELAY_MS,
                              MAX_TIMING_DELAY_MS
                            )
                          }
                          onBlur={() =>
                            clampBoundedIntegerDraft(
                              setSettingsDraft,
                              'snapshotMirrorFlushTimeoutMs',
                              settingsDraft.snapshotMirrorFlushTimeoutMs,
                              MIN_TIMING_DELAY_MS,
                              MAX_TIMING_DELAY_MS
                            )
                          }
                        />
                      </label>
                      <label className="settings-field">
                        <span className="settings-field__label">{`Window screenshot delay (ms, ${MIN_TIMING_DELAY_MS}-${MAX_TIMING_DELAY_MS})`}</span>
                        <input
                          className="settings-field__input"
                          type="number"
                          min={MIN_TIMING_DELAY_MS}
                          max={MAX_TIMING_DELAY_MS}
                          step={1}
                          value={settingsDraft.windowScreenshotCaptureDelayMs}
                          onChange={(event) =>
                            updateBoundedIntegerDraft(
                              setSettingsDraft,
                              'windowScreenshotCaptureDelayMs',
                              event.target.value,
                              MIN_TIMING_DELAY_MS,
                              MAX_TIMING_DELAY_MS
                            )
                          }
                          onBlur={() =>
                            clampBoundedIntegerDraft(
                              setSettingsDraft,
                              'windowScreenshotCaptureDelayMs',
                              settingsDraft.windowScreenshotCaptureDelayMs,
                              MIN_TIMING_DELAY_MS,
                              MAX_TIMING_DELAY_MS
                            )
                          }
                        />
                      </label>
                      <label className="settings-field">
                        <span className="settings-field__label">{`Terminal screenshot resize settle (ms, ${MIN_TIMING_DELAY_MS}-${MAX_TIMING_DELAY_MS})`}</span>
                        <input
                          className="settings-field__input"
                          type="number"
                          min={MIN_TIMING_DELAY_MS}
                          max={MAX_TIMING_DELAY_MS}
                          step={1}
                          value={settingsDraft.terminalScreenshotResizeSettleMs}
                          onChange={(event) =>
                            updateBoundedIntegerDraft(
                              setSettingsDraft,
                              'terminalScreenshotResizeSettleMs',
                              event.target.value,
                              MIN_TIMING_DELAY_MS,
                              MAX_TIMING_DELAY_MS
                            )
                          }
                          onBlur={() =>
                            clampBoundedIntegerDraft(
                              setSettingsDraft,
                              'terminalScreenshotResizeSettleMs',
                              settingsDraft.terminalScreenshotResizeSettleMs,
                              MIN_TIMING_DELAY_MS,
                              MAX_TIMING_DELAY_MS
                            )
                          }
                        />
                      </label>
                      <label className="settings-field">
                        <span className="settings-field__label">{`Terminal screenshot poll interval (ms, ${MIN_TIMING_DELAY_MS}-${MAX_TIMING_DELAY_MS})`}</span>
                        <input
                          className="settings-field__input"
                          type="number"
                          min={MIN_TIMING_DELAY_MS}
                          max={MAX_TIMING_DELAY_MS}
                          step={1}
                          value={settingsDraft.terminalScreenshotPollIntervalMs}
                          onChange={(event) =>
                            updateBoundedIntegerDraft(
                              setSettingsDraft,
                              'terminalScreenshotPollIntervalMs',
                              event.target.value,
                              MIN_TIMING_DELAY_MS,
                              MAX_TIMING_DELAY_MS
                            )
                          }
                          onBlur={() =>
                            clampBoundedIntegerDraft(
                              setSettingsDraft,
                              'terminalScreenshotPollIntervalMs',
                              settingsDraft.terminalScreenshotPollIntervalMs,
                              MIN_TIMING_DELAY_MS,
                              MAX_TIMING_DELAY_MS
                            )
                          }
                        />
                      </label>
                      <label className="settings-field">
                        <span className="settings-field__label">{`Terminal screenshot ready timeout (ms, ${MIN_TIMING_DELAY_MS}-${MAX_TIMING_DELAY_MS})`}</span>
                        <input
                          className="settings-field__input"
                          type="number"
                          min={MIN_TIMING_DELAY_MS}
                          max={MAX_TIMING_DELAY_MS}
                          step={1}
                          value={settingsDraft.terminalScreenshotReadyTimeoutMs}
                          onChange={(event) =>
                            updateBoundedIntegerDraft(
                              setSettingsDraft,
                              'terminalScreenshotReadyTimeoutMs',
                              event.target.value,
                              MIN_TIMING_DELAY_MS,
                              MAX_TIMING_DELAY_MS
                            )
                          }
                          onBlur={() =>
                            clampBoundedIntegerDraft(
                              setSettingsDraft,
                              'terminalScreenshotReadyTimeoutMs',
                              settingsDraft.terminalScreenshotReadyTimeoutMs,
                              MIN_TIMING_DELAY_MS,
                              MAX_TIMING_DELAY_MS
                            )
                          }
                        />
                      </label>
                    </div>
                  </div>

                  <div className="settings-group">
                    <div className="settings-group__header">
                      <h3 className="settings-group__title">System operations</h3>
                      <p className="settings-group__description">Adjust the waits used when restarting the app and downloading Discord attachments.</p>
                    </div>
                    <div className="settings-grid settings-grid--compact">
                      <label className="settings-field">
                        <span className="settings-field__label">{`App restart delay (ms, ${MIN_TIMING_DELAY_MS}-${MAX_TIMING_DELAY_MS})`}</span>
                        <input
                          className="settings-field__input"
                          type="number"
                          min={MIN_TIMING_DELAY_MS}
                          max={MAX_TIMING_DELAY_MS}
                          step={1}
                          value={settingsDraft.appRestartDelayMs}
                          onChange={(event) =>
                            updateBoundedIntegerDraft(setSettingsDraft, 'appRestartDelayMs', event.target.value, MIN_TIMING_DELAY_MS, MAX_TIMING_DELAY_MS)
                          }
                          onBlur={() =>
                            clampBoundedIntegerDraft(
                              setSettingsDraft,
                              'appRestartDelayMs',
                              settingsDraft.appRestartDelayMs,
                              MIN_TIMING_DELAY_MS,
                              MAX_TIMING_DELAY_MS
                            )
                          }
                        />
                      </label>
                      <label className="settings-field">
                        <span className="settings-field__label">{`Attachment download timeout (ms, ${MIN_TIMING_DELAY_MS}-${MAX_TIMING_DELAY_MS})`}</span>
                        <input
                          className="settings-field__input"
                          type="number"
                          min={MIN_TIMING_DELAY_MS}
                          max={MAX_TIMING_DELAY_MS}
                          step={1}
                          value={settingsDraft.attachmentDownloadTimeoutMs}
                          onChange={(event) =>
                            updateBoundedIntegerDraft(
                              setSettingsDraft,
                              'attachmentDownloadTimeoutMs',
                              event.target.value,
                              MIN_TIMING_DELAY_MS,
                              MAX_TIMING_DELAY_MS
                            )
                          }
                          onBlur={() =>
                            clampBoundedIntegerDraft(
                              setSettingsDraft,
                              'attachmentDownloadTimeoutMs',
                              settingsDraft.attachmentDownloadTimeoutMs,
                              MIN_TIMING_DELAY_MS,
                              MAX_TIMING_DELAY_MS
                            )
                          }
                        />
                      </label>
                    </div>
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
                            <span className="settings-field__label">Default working directory</span>
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

function createSettingsDraft(bridgeSettings: BridgeSettings): SettingsDraft {
  return {
    autoScreenshotOnReply: bridgeSettings.autoScreenshotOnReply,
    inflightScreenshotOnRunningRequest: bridgeSettings.inflightScreenshotOnRunningRequest,
    replyFormat: bridgeSettings.replyFormat,
    softTimeoutSeconds: String(Math.round(bridgeSettings.softTimeoutMs / 1000)),
    hardTimeoutSeconds:
      bridgeSettings.hardTimeoutMs === null ? String(DEFAULT_HARD_TIMEOUT_SECONDS) : String(Math.round(bridgeSettings.hardTimeoutMs / 1000)),
    hardTimeoutUnlimited: bridgeSettings.hardTimeoutMs === null,
    artifactWatchDirectory: bridgeSettings.artifactPublish.watchDirectory,
    diffAnchorChars: String(bridgeSettings.diffAnchorChars),
    bridgeCols: String(bridgeSettings.bridgeDimensions.cols),
    bridgeRows: String(bridgeSettings.bridgeDimensions.rows),
    inflightScreenshotDelaySeconds: String(Math.round(bridgeSettings.timing.inflightScreenshotDelayMs / 1000)),
    redrawWaitAfterShrinkMs: String(bridgeSettings.timing.redrawWaitAfterShrinkMs),
    beforeSendRedrawRestoreMs: String(bridgeSettings.timing.beforeSendRedrawRestoreMs),
    afterCompleteRedrawRestoreMs: String(bridgeSettings.timing.afterCompleteRedrawRestoreMs),
    beforeSendPostRedrawDelayMs: String(bridgeSettings.timing.beforeSendPostRedrawDelayMs),
    preTextInputSnapshotDelayMs: String(bridgeSettings.timing.preTextInputSnapshotDelayMs),
    textSubmitEnterDelayMs: String(bridgeSettings.timing.textSubmitEnterDelayMs),
    repeatedControlKeyDelayMs: String(bridgeSettings.timing.repeatedControlKeyDelayMs),
    completionSettleMs: String(bridgeSettings.timing.completionSettleMs),
    completionNoOutputTimeoutMs: String(bridgeSettings.timing.completionNoOutputTimeoutMs),
    completionPollIntervalMs: String(bridgeSettings.timing.completionPollIntervalMs),
    completionStablePollCount: String(bridgeSettings.timing.completionStablePollCount),
    manualRedrawWaitAfterShrinkMs: String(bridgeSettings.timing.manualRedrawWaitAfterShrinkMs),
    manualRedrawWaitAfterRestoreMs: String(bridgeSettings.timing.manualRedrawWaitAfterRestoreMs),
    liveViewSnapshotDebounceMs: String(bridgeSettings.timing.liveViewSnapshotDebounceMs),
    snapshotMirrorFlushTimeoutMs: String(bridgeSettings.timing.snapshotMirrorFlushTimeoutMs),
    windowScreenshotCaptureDelayMs: String(bridgeSettings.timing.windowScreenshotCaptureDelayMs),
    terminalScreenshotResizeSettleMs: String(bridgeSettings.timing.terminalScreenshotResizeSettleMs),
    terminalScreenshotPollIntervalMs: String(bridgeSettings.timing.terminalScreenshotPollIntervalMs),
    terminalScreenshotReadyTimeoutMs: String(bridgeSettings.timing.terminalScreenshotReadyTimeoutMs),
    appRestartDelayMs: String(bridgeSettings.timing.appRestartDelayMs),
    attachmentDownloadTimeoutMs: String(bridgeSettings.timing.attachmentDownloadTimeoutMs)
  };
}

function updateBoundedIntegerDraft(
  setSettingsDraft: Dispatch<SetStateAction<SettingsDraft>>,
  key: SettingsNumericField,
  nextValue: string,
  min: number,
  max: number
) {
  const normalized = nextValue.trim();
  if (normalized === '') {
    setSettingsDraft((current) => ({
      ...current,
      [key]: normalized
    }));
    return;
  }

  if (!/^\d+$/.test(normalized) || !isNumericPrefixWithinRange(normalized, min, max)) {
    return;
  }

  setSettingsDraft((current) => ({
    ...current,
    [key]: normalized
  }));
}

function clampBoundedIntegerDraft(
  setSettingsDraft: Dispatch<SetStateAction<SettingsDraft>>,
  key: SettingsNumericField,
  currentValue: string,
  min: number,
  max: number
) {
  const clamped = clampBoundedInteger(currentValue, min, max);
  setSettingsDraft((current) => ({
    ...current,
    [key]: String(clamped)
  }));
}

function parseBoundedInteger(value: string, min: number, max: number): number {
  if (!/^\d+$/.test(value.trim())) {
    return Number.NaN;
  }

  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
    return Number.NaN;
  }

  return parsed;
}

function clampBoundedInteger(value: string, min: number, max: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return min;
  }

  return Math.min(max, Math.max(min, Math.round(parsed)));
}

function isNumericPrefixWithinRange(value: string, min: number, max: number): boolean {
  for (let candidate = min; candidate <= max; candidate += 1) {
    const candidateText = String(candidate);
    if (candidateText.startsWith(value)) {
      return true;
    }
  }

  return false;
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
      const existing = current[existingBySlot];
      if (existing.id !== next.id && existing.status !== 'exited' && next.status === 'exited') {
        return current;
      }

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

function appendAppLogEntry(current: AppLogEntry[], entry: AppLogEntry): AppLogEntry[] {
  if (current.length >= MAX_RENDERED_APP_LOGS) {
    return [...current.slice(current.length - MAX_RENDERED_APP_LOGS + 1), entry];
  }

  return [...current, entry];
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
