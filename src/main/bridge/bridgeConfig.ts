import { app } from 'electron';
import path from 'node:path';
import type { TerminalDimensions } from '../../shared/terminal';

export interface BridgeRuntimeConfig {
  discordBotToken?: string;
  allowUserIds: string[];
  allowChannelIds: string[];
  bridgeDimensions: TerminalDimensions;
  completion: {
    settleMs: number;
    softTimeoutMs: number;
    noOutputTimeoutMs: number;
    hardTimeoutMs: number;
    pollIntervalMs: number;
    stablePollCount: number;
  };
  diff: {
    tailChars: number;
    fallbackLines: number;
  };
  reply: {
    maxMessages: number;
    maxMessageLength: number;
    targetChunkLength: number;
    truncatedNote: string;
  };
  storage: {
    snapshotDirectory: string;
    processingLogDirectory: string;
  };
}

const DEFAULT_DIMENSIONS: TerminalDimensions = {
  cols: 120,
  rows: 32
};

export function loadBridgeRuntimeConfig(): BridgeRuntimeConfig {
  return {
    discordBotToken: readOptionalString('DISCORD_BOT_TOKEN'),
    allowUserIds: parseList(['ALLOW_USER_IDS', 'DISCORD_ALLOWED_USER_IDS', 'DISCORD_ALLOWED_USER_ID']),
    allowChannelIds: parseList(['ALLOW_CHANNEL_IDS', 'DISCORD_ALLOWED_CHANNEL_IDS']),
    bridgeDimensions: DEFAULT_DIMENSIONS,
    completion: {
      settleMs: readNumber('BRIDGE_SETTLE_MS', 2000),
      softTimeoutMs: readNumber('BRIDGE_SOFT_TIMEOUT_MS', 20000),
      noOutputTimeoutMs: readNumber('BRIDGE_NO_OUTPUT_TIMEOUT_MS', 3000),
      hardTimeoutMs: readNumber('BRIDGE_HARD_TIMEOUT_MS', 120000),
      pollIntervalMs: readNumber('BRIDGE_POLL_INTERVAL_MS', 500),
      stablePollCount: readNumber('BRIDGE_STABLE_POLL_COUNT', 3)
    },
    diff: {
      tailChars: readNumber('BRIDGE_DIFF_TAIL_CHARS', 10000),
      fallbackLines: readNumber('BRIDGE_DIFF_FALLBACK_LINES', 40)
    },
    reply: {
      maxMessages: readNumber('BRIDGE_REPLY_MAX_MESSAGES', 5),
      maxMessageLength: readNumber('BRIDGE_REPLY_MAX_LENGTH', 1900),
      targetChunkLength: readNumber('BRIDGE_REPLY_TARGET_LENGTH', 1800),
      truncatedNote: '[truncated: diff exceeded Discord reply limit]'
    },
    storage: {
      snapshotDirectory: path.join(app.getPath('userData'), 'discord-bridge', 'snapshots'),
      processingLogDirectory: path.join(app.getPath('userData'), 'discord-bridge', 'processing-logs')
    }
  };
}

function parseList(names: string | string[]): string[] {
  const value = readOptionalString(names);
  if (!value) {
    return [];
  }

  return [...new Set(value.split(/[,\s]+/).map((part) => part.trim()).filter(Boolean))];
}

function readOptionalString(names: string | string[]): string | undefined {
  const candidates = Array.isArray(names) ? names : [names];
  for (const name of candidates) {
    const value = process.env[name]?.trim();
    if (value) {
      return value;
    }
  }

  return undefined;
}

function readNumber(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) {
    return fallback;
  }

  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }

  return parsed;
}
