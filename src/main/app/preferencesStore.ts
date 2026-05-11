import { app, Rectangle } from 'electron';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

interface StoredWindowBounds extends Pick<Rectangle, 'x' | 'y' | 'width' | 'height'> {}

interface StoredPreferences {
  lastCwd?: string;
  defaultWorkspaceCwd?: string;
  windowBounds?: StoredWindowBounds;
  terminalSlots?: StoredTerminalSlot[];
  bridgeSettings?: {
    autoScreenshotOnReply?: boolean;
    softTimeoutMs?: number;
    hardTimeoutMs?: number;
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
  autoScreenshotOnReply: false,
  softTimeoutMs: 20000,
  hardTimeoutMs: 120000,
  bridgeDimensions: {
    cols: 120,
    rows: 32
  }
} as const;
const MIN_BRIDGE_COLS = 40;
const MIN_BRIDGE_ROWS = 10;
const MAX_BRIDGE_COLS = 240;
const MAX_BRIDGE_ROWS = 80;
const MIN_SOFT_TIMEOUT_MS = 1000;
const MAX_SOFT_TIMEOUT_MS = 300000;
const MIN_HARD_TIMEOUT_MS = 5000;
const MAX_HARD_TIMEOUT_MS = 600000;
const SLOT_IDS = [1, 2, 3, 4] as const;

export class PreferencesStore {
  private readonly filePath: string;
  private state: StoredPreferences;

  constructor() {
    this.filePath = path.join(app.getPath('userData'), 'preferences.json');
    this.state = this.load();
    this.ensureTerminalSlotsPersisted();
  }

  getLastCwd(): string | undefined {
    return this.state.lastCwd;
  }

  getDefaultWorkspaceCwd(): string {
    return this.state.defaultWorkspaceCwd?.trim() || this.state.lastCwd || process.cwd();
  }

  setLastCwd(cwd: string): void {
    this.state.lastCwd = cwd;
    this.save();
  }

  setDefaultWorkspaceCwd(cwd: string): string {
    const normalized = cwd.trim();
    if (normalized.length === 0) {
      delete this.state.defaultWorkspaceCwd;
    } else {
      this.state.defaultWorkspaceCwd = normalized;
    }
    this.save();
    return this.getDefaultWorkspaceCwd();
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
    softTimeoutMs: number;
    hardTimeoutMs: number;
    bridgeDimensions: { cols: number; rows: number };
  } {
    return {
      autoScreenshotOnReply: this.state.bridgeSettings?.autoScreenshotOnReply ?? DEFAULT_BRIDGE_SETTINGS.autoScreenshotOnReply,
      softTimeoutMs: clampInteger(
        this.state.bridgeSettings?.softTimeoutMs,
        MIN_SOFT_TIMEOUT_MS,
        MAX_SOFT_TIMEOUT_MS,
        DEFAULT_BRIDGE_SETTINGS.softTimeoutMs
      ),
      hardTimeoutMs: clampInteger(
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
    softTimeoutMs?: number;
    hardTimeoutMs?: number;
    bridgeDimensions?: { cols?: number; rows?: number };
  }): {
    autoScreenshotOnReply: boolean;
    softTimeoutMs: number;
    hardTimeoutMs: number;
    bridgeDimensions: { cols: number; rows: number };
  } {
    this.state.bridgeSettings = {
      ...this.state.bridgeSettings,
      ...(update.autoScreenshotOnReply === undefined
        ? {}
        : { autoScreenshotOnReply: Boolean(update.autoScreenshotOnReply) }),
      ...(update.softTimeoutMs === undefined ? {} : { softTimeoutMs: update.softTimeoutMs }),
      ...(update.hardTimeoutMs === undefined ? {} : { hardTimeoutMs: update.hardTimeoutMs }),
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
}

function clampInteger(value: number | undefined, min: number, max: number, fallback: number): number {
  if (!Number.isFinite(value)) {
    return fallback;
  }

  return Math.max(min, Math.min(max, Math.round(value as number)));
}

function normalizeWorkspaceName(value: string | undefined, slotId: 1 | 2 | 3 | 4): string {
  const normalized = value?.trim();
  return normalized && normalized.length > 0 ? normalized : `terminal-${slotId}`;
}
