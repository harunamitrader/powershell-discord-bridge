import { app } from 'electron';
import path from 'node:path';
import type { TerminalDimensions } from '../../shared/terminal';

export interface BridgeRuntimeConfig {
  discordBotToken?: string;
  allowUserIds: string[];
  guildId?: string;
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

export function loadBridgeRuntimeConfig(): BridgeRuntimeConfig {
  return {
    discordBotToken: readOptionalString('DISCORD_BOT_TOKEN'),
    allowUserIds: parseList(['ALLOW_USER_IDS', 'DISCORD_ALLOWED_USER_IDS', 'DISCORD_ALLOWED_USER_ID']),
    guildId: readOptionalString(['ALLOW_GUILD_ID', 'ALLOW_GUILD_IDS', 'DISCORD_ALLOWED_GUILD_ID', 'DISCORD_ALLOWED_GUILD_IDS']),
    completion: {
      settleMs: 2000,
      softTimeoutMs: 20000,
      noOutputTimeoutMs: 3000,
      hardTimeoutMs: 120000,
      pollIntervalMs: 500,
      stablePollCount: 3
    },
    diff: {
      tailChars: readNumber('BRIDGE_DIFF_TAIL_CHARS', 10000),
      fallbackLines: readNumber('BRIDGE_DIFF_FALLBACK_LINES', 40)
    },
    reply: {
      maxMessages: readNumber('BRIDGE_REPLY_MAX_MESSAGES', 5),
      maxMessageLength: readNumber('BRIDGE_REPLY_MAX_LENGTH', 1900),
      targetChunkLength: readNumber('BRIDGE_REPLY_TARGET_LENGTH', 1888),
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
