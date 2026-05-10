import { app, Rectangle } from 'electron';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

interface StoredWindowBounds extends Pick<Rectangle, 'x' | 'y' | 'width' | 'height'> {}

interface StoredPreferences {
  lastCwd?: string;
  sidebarWidth?: number;
  windowBounds?: StoredWindowBounds;
}

const DEFAULT_SIDEBAR_WIDTH = 280;

export class PreferencesStore {
  private readonly filePath: string;
  private state: StoredPreferences;

  constructor() {
    this.filePath = path.join(app.getPath('userData'), 'preferences.json');
    this.state = this.load();
  }

  getDefaultSidebarWidth(): number {
    return this.state.sidebarWidth ?? DEFAULT_SIDEBAR_WIDTH;
  }

  setSidebarWidth(width: number): void {
    this.state.sidebarWidth = Math.max(220, Math.min(420, Math.round(width)));
    this.save();
  }

  getLastCwd(): string | undefined {
    return this.state.lastCwd;
  }

  setLastCwd(cwd: string): void {
    this.state.lastCwd = cwd;
    this.save();
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
}
