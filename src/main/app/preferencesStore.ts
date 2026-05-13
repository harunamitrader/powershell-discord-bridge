import type { BridgeReplyFormat } from '../../shared/terminal';
import { app, Rectangle } from 'electron';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

interface StoredWindowBounds extends Pick<Rectangle, 'x' | 'y' | 'width' | 'height'> {}

interface StoredPreferences {
  lastCwd?: string;
  windowBounds?: StoredWindowBounds;
  terminalSlots?: StoredTerminalSlot[];
  bridgeSettings?: {
    autoScreenshotOnReply?: boolean;
    replyFormat?: BridgeReplyFormat;
    softTimeoutMs?: number;
    hardTimeoutMs?: number | null;
    bridgeDimensions?: {
      cols?: number;
      rows?: number;
    };
  };
}

interface StoredTerminalSlot {
  slotId: 1 | 2 | 3 | 4;
  workspaceName?: string;
  channelId?: string;
  cwd?: string;
}

const DEFAULT_BRIDGE_SETTINGS = {
  autoScreenshotOnReply: true,
  replyFormat: 'command' as BridgeReplyFormat,
  softTimeoutMs: 300000,
  hardTimeoutMs: null,
  bridgeDimensions: {
    cols: 100,
    rows: 50
  }
} as const;
const MIN_BRIDGE_COLS = 40;
const MIN_BRIDGE_ROWS = 15;
const MAX_BRIDGE_COLS = 400;
const MAX_BRIDGE_ROWS = 120;
const MIN_SOFT_TIMEOUT_MS = 1000;
const MAX_SOFT_TIMEOUT_MS = 300000;
const MIN_HARD_TIMEOUT_MS = 5000;
const MAX_HARD_TIMEOUT_MS = 7200000;
const SLOT_IDS = [1, 2, 3, 4] as const;

export class PreferencesStore {
  private readonly filePath: string;
  private state: StoredPreferences;

  constructor() {
    this.filePath = path.join(app.getPath('userData'), 'preferences.json');
    this.state = this.load();
    this.removeLegacyDefaultWorkspaceCwd();
    this.ensureTerminalSlotsPersisted();
  }

  getLastCwd(): string | undefined {
    return this.state.lastCwd;
  }

  getDefaultWorkspaceCwd(): string {
    return this.state.lastCwd || app.getPath('home');
  }

  setLastCwd(cwd: string): void {
    this.state.lastCwd = cwd;
    this.save();
  }

  getTerminalSlots(): { slotId: 1 | 2 | 3 | 4; workspaceName: string; channelId: string; cwd: string }[] {
    const defaultCwd = this.getDefaultWorkspaceCwd();
    const storedById = new Map((this.state.terminalSlots ?? []).map((slot) => [slot.slotId, slot]));
    return SLOT_IDS.map((slotId) => {
      const stored = storedById.get(slotId);
      return {
        slotId,
        workspaceName: normalizeWorkspaceName(stored?.workspaceName, slotId),
        channelId: stored?.channelId?.trim() ?? '',
        cwd: stored?.cwd?.trim() || defaultCwd
      };
    });
  }

  updateTerminalSlot(
    slotId: 1 | 2 | 3 | 4,
    update: { workspaceName?: string; channelId?: string; cwd?: string }
  ): { slotId: 1 | 2 | 3 | 4; workspaceName: string; channelId: string; cwd: string } {
    const slots = this.getTerminalSlots();
    const index = slots.findIndex((slot) => slot.slotId === slotId);
    if (index === -1) {
      throw new Error(`Unknown terminal slot: ${slotId}`);
    }

    const current = slots[index];
    const next = {
      slotId,
      workspaceName:
        update.workspaceName === undefined ? current.workspaceName : normalizeWorkspaceName(update.workspaceName, slotId),
      channelId: update.channelId === undefined ? current.channelId : update.channelId.trim(),
      cwd: update.cwd === undefined ? current.cwd : update.cwd.trim() || this.getDefaultWorkspaceCwd()
    };

    slots[index] = next;
    this.state.terminalSlots = slots;
    this.save();
    return next;
  }

  getWindowBounds(): StoredWindowBounds | undefined {
    return this.state.windowBounds;
  }

  setWindowBounds(bounds: Rectangle): void {
    this.state.windowBounds = {
      x: bounds.x,
      y: bounds.y,
      width: bounds.width,
      height: bounds.height
    };
    this.save();
  }

  getBridgeSettings(): {
    autoScreenshotOnReply: boolean;
    replyFormat: BridgeReplyFormat;
    softTimeoutMs: number;
    hardTimeoutMs: number | null;
    bridgeDimensions: { cols: number; rows: number };
  } {
    return {
      autoScreenshotOnReply: this.state.bridgeSettings?.autoScreenshotOnReply ?? DEFAULT_BRIDGE_SETTINGS.autoScreenshotOnReply,
      replyFormat: normalizeBridgeReplyFormat(this.state.bridgeSettings?.replyFormat),
      softTimeoutMs: clampInteger(
        this.state.bridgeSettings?.softTimeoutMs,
        MIN_SOFT_TIMEOUT_MS,
        MAX_SOFT_TIMEOUT_MS,
        DEFAULT_BRIDGE_SETTINGS.softTimeoutMs
      ),
      hardTimeoutMs: clampNullableInteger(
        this.state.bridgeSettings?.hardTimeoutMs,
        MIN_HARD_TIMEOUT_MS,
        MAX_HARD_TIMEOUT_MS,
        DEFAULT_BRIDGE_SETTINGS.hardTimeoutMs
      ),
      bridgeDimensions: {
        cols: clampInteger(
          this.state.bridgeSettings?.bridgeDimensions?.cols,
          MIN_BRIDGE_COLS,
          MAX_BRIDGE_COLS,
          DEFAULT_BRIDGE_SETTINGS.bridgeDimensions.cols
        ),
        rows: clampInteger(
          this.state.bridgeSettings?.bridgeDimensions?.rows,
          MIN_BRIDGE_ROWS,
          MAX_BRIDGE_ROWS,
          DEFAULT_BRIDGE_SETTINGS.bridgeDimensions.rows
        )
      }
    };
  }

  setBridgeSettings(update: {
    autoScreenshotOnReply?: boolean;
    replyFormat?: BridgeReplyFormat;
    softTimeoutMs?: number;
    hardTimeoutMs?: number | null;
    bridgeDimensions?: { cols?: number; rows?: number };
  }): {
    autoScreenshotOnReply: boolean;
    replyFormat: BridgeReplyFormat;
    softTimeoutMs: number;
    hardTimeoutMs: number | null;
    bridgeDimensions: { cols: number; rows: number };
  } {
    this.state.bridgeSettings = {
      ...this.state.bridgeSettings,
      ...(update.autoScreenshotOnReply === undefined
        ? {}
        : { autoScreenshotOnReply: Boolean(update.autoScreenshotOnReply) }),
      ...(update.replyFormat === undefined ? {} : { replyFormat: update.replyFormat }),
      ...(update.softTimeoutMs === undefined ? {} : { softTimeoutMs: update.softTimeoutMs }),
      ...(update.hardTimeoutMs === undefined ? {} : { hardTimeoutMs: update.hardTimeoutMs === null ? null : update.hardTimeoutMs }),
      ...(update.bridgeDimensions
        ? {
            bridgeDimensions: {
              ...this.state.bridgeSettings?.bridgeDimensions,
              ...update.bridgeDimensions
            }
          }
        : {})
    };
    this.save();
    return this.getBridgeSettings();
  }

  private load(): StoredPreferences {
    if (!existsSync(this.filePath)) {
      return {};
    }

    try {
      const raw = readFileSync(this.filePath, 'utf8');
      return JSON.parse(raw) as StoredPreferences;
    } catch {
      return {};
    }
  }

  private save(): void {
    const directory = path.dirname(this.filePath);
    if (!existsSync(directory)) {
      mkdirSync(directory, { recursive: true });
    }

    writeFileSync(this.filePath, JSON.stringify(this.state, null, 2), 'utf8');
  }

  private ensureTerminalSlotsPersisted(): void {
    const normalizedSlots = this.getTerminalSlots();
    const currentSerialized = JSON.stringify(this.state.terminalSlots ?? []);
    const normalizedSerialized = JSON.stringify(normalizedSlots);
    if (currentSerialized === normalizedSerialized) {
      return;
    }

    this.state.terminalSlots = normalizedSlots;
    this.save();
  }

  private removeLegacyDefaultWorkspaceCwd(): void {
    if (!('defaultWorkspaceCwd' in this.state)) {
      return;
    }

    delete (this.state as StoredPreferences & { defaultWorkspaceCwd?: string }).defaultWorkspaceCwd;
    this.save();
  }
}

function clampInteger(value: number | undefined, min: number, max: number, fallback: number): number {
  if (!Number.isFinite(value)) {
    return fallback;
  }

  return Math.max(min, Math.min(max, Math.round(value as number)));
}

function clampNullableInteger(value: number | null | undefined, min: number, max: number, fallback: number | null): number | null {
  if (value === null) {
    return null;
  }

  if (fallback === null) {
    return !Number.isFinite(value) ? null : Math.max(min, Math.min(max, Math.round(value as number)));
  }

  return clampInteger(value, min, max, fallback);
}

function normalizeBridgeReplyFormat(value: BridgeReplyFormat | undefined): BridgeReplyFormat {
  return value === 'command' || value === 'plain-text' ? value : DEFAULT_BRIDGE_SETTINGS.replyFormat;
}

function normalizeWorkspaceName(value: string | undefined, slotId: 1 | 2 | 3 | 4): string {
  const normalized = value?.trim();
  return normalized && normalized.length > 0 ? normalized : `terminal-${slotId}`;
}
