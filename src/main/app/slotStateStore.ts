import { app } from 'electron';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type {
  TerminalSessionSummary,
  TerminalSlotId,
  TerminalSlotInboundEntry,
  TerminalSlotInboundKind,
  TerminalSlotState,
  TerminalSlotStateSnapshot,
  TerminalWriteSource
} from '../../shared/terminal';
import { TerminalSlotService } from './terminalSlotService';

const MAX_RECENT_INBOUND = 5;
const MAX_FOREGROUND_COMMAND_LENGTH = 200;
const MAX_INBOUND_TEXT_LENGTH = 4000;

interface SlotStateRecord {
  publicState: TerminalSlotState;
  awaitingCommandAfterPromptReady: boolean;
  pendingCommandBuffer: string;
}

export class SlotStateStore {
  private readonly records = new Map<TerminalSlotId, SlotStateRecord>();
  private readonly filePath: string;

  constructor(private readonly terminalSlotService: TerminalSlotService) {
    this.filePath = path.join(app.getPath('userData'), 'coordination', 'slot-state.json');
    this.ensureAllSlots();
    this.persist();
  }

  getFilePath(): string {
    return this.filePath;
  }

  getSnapshot(slotId?: TerminalSlotId): TerminalSlotStateSnapshot {
    this.ensureAllSlots();
    const slots = [...this.records.values()]
      .map((record) => cloneSlotState(record.publicState))
      .sort((left, right) => left.slotId - right.slotId);

    return {
      schemaVersion: 1,
      generatedAt: new Date().toISOString(),
      slots: typeof slotId === 'number' ? slots.filter((entry) => entry.slotId === slotId) : slots
    };
  }

  recordSessionSummary(summary: TerminalSessionSummary): void {
    const slotId = summary.slotId ?? this.terminalSlotService.getSlotIdBySessionId(summary.id);
    if (!slotId) {
      return;
    }

    const record = this.ensureRecord(slotId);
    const occurredAt = new Date().toISOString();
    let changed = false;
    const sessionChanged = record.publicState.sessionId !== summary.id;
    if (sessionChanged) {
      record.publicState.sessionId = summary.id;
      record.publicState.foregroundCommand = undefined;
      record.publicState.status = summary.status === 'exited' ? 'exited' : 'starting';
      record.awaitingCommandAfterPromptReady = false;
      record.pendingCommandBuffer = '';
      changed = true;
    }

    if (summary.cwd && record.publicState.cwd !== summary.cwd) {
      record.publicState.cwd = summary.cwd;
      changed = true;
    }

    const nextStatus = summary.status === 'exited' ? 'exited' : record.publicState.status;
    if (record.publicState.status !== nextStatus) {
      record.publicState.status = nextStatus;
      changed = true;
    }

    if (changed) {
      record.publicState.updatedAt = occurredAt;
      this.persist();
    }
  }

  recordPromptReady(sessionId: string, occurredAt: string): void {
    const record = this.getRecordBySessionId(sessionId);
    if (!record) {
      return;
    }

    record.publicState.status = 'powershell-ready';
    record.publicState.foregroundCommand = undefined;
    record.publicState.updatedAt = occurredAt;
    record.awaitingCommandAfterPromptReady = true;
    record.pendingCommandBuffer = '';
    this.persist();
  }

  recordTerminalWrite(sessionId: string, data: string, _source: TerminalWriteSource, occurredAt: string): void {
    const record = this.getRecordBySessionId(sessionId);
    if (!record || !record.awaitingCommandAfterPromptReady || data.length === 0) {
      return;
    }

    let didCaptureCommand = false;
    for (let index = 0; index < data.length; index += 1) {
      const character = data[index];
      if (character === '\u001b') {
        index = skipEscapeSequence(data, index);
        continue;
      }

      if (character === '\r') {
        didCaptureCommand = finalizePendingCommand(record, occurredAt) || didCaptureCommand;
        continue;
      }

      if (character === '\u0008' || character === '\u007f') {
        record.pendingCommandBuffer = record.pendingCommandBuffer.slice(0, -1);
        continue;
      }

      if (character === '\n') {
        record.pendingCommandBuffer += '\n';
        continue;
      }

      if (isPrintableCommandCharacter(character)) {
        record.pendingCommandBuffer += character;
      }
    }

    if (didCaptureCommand) {
      this.persist();
    }
  }

  recordInbound(slotId: TerminalSlotId, entry: { timestamp: string; from: string; kind: TerminalSlotInboundKind; text: string }): void {
    const normalizedText = normalizeInboundText(entry.text);
    if (!normalizedText) {
      return;
    }

    const record = this.ensureRecord(slotId);
    const inboundEntry: TerminalSlotInboundEntry = {
      timestamp: entry.timestamp,
      from: entry.from,
      kind: entry.kind,
      text: normalizedText
    };
    record.publicState.recentInbound = [inboundEntry, ...record.publicState.recentInbound].slice(0, MAX_RECENT_INBOUND);
    record.publicState.updatedAt = entry.timestamp;
    this.persist();
  }

  recordSessionExit(sessionId: string): void {
    const record = this.getRecordBySessionId(sessionId);
    if (!record) {
      return;
    }

    record.publicState.status = 'exited';
    record.publicState.foregroundCommand = undefined;
    record.publicState.updatedAt = new Date().toISOString();
    record.awaitingCommandAfterPromptReady = false;
    record.pendingCommandBuffer = '';
    this.persist();
  }

  private ensureAllSlots(): void {
    for (const slot of this.terminalSlotService.listSlots()) {
      this.ensureRecord(slot.slotId);
    }
  }

  private ensureRecord(slotId: TerminalSlotId): SlotStateRecord {
    const existing = this.records.get(slotId);
    if (existing) {
      if (!existing.publicState.cwd) {
        existing.publicState.cwd = this.terminalSlotService.getSlot(slotId).cwd;
      }
      return existing;
    }

    const now = new Date().toISOString();
    const sessionId = this.terminalSlotService.getSessionIdForSlot(slotId);
    const record: SlotStateRecord = {
      publicState: {
        slotId,
        sessionId,
        cwd: this.terminalSlotService.getSlot(slotId).cwd,
        status: sessionId ? 'starting' : 'exited',
        updatedAt: now,
        recentInbound: []
      },
      awaitingCommandAfterPromptReady: false,
      pendingCommandBuffer: ''
    };
    this.records.set(slotId, record);
    return record;
  }

  private getRecordBySessionId(sessionId: string): SlotStateRecord | undefined {
    for (const record of this.records.values()) {
      if (record.publicState.sessionId === sessionId) {
        return record;
      }
    }

    return undefined;
  }

  private persist(): void {
    mkdirSync(path.dirname(this.filePath), { recursive: true });
    writeFileSync(this.filePath, JSON.stringify(this.getSnapshot(), null, 2), 'utf8');
  }
}

function finalizePendingCommand(record: SlotStateRecord, occurredAt: string): boolean {
  const command = normalizeForegroundCommand(record.pendingCommandBuffer);
  record.pendingCommandBuffer = '';
  if (!command) {
    return false;
  }

  record.publicState.foregroundCommand = command;
  record.publicState.status = 'command-active';
  record.publicState.updatedAt = occurredAt;
  record.awaitingCommandAfterPromptReady = false;
  return true;
}

function cloneSlotState(state: TerminalSlotState): TerminalSlotState {
  return {
    ...state,
    recentInbound: state.recentInbound.map((entry) => ({ ...entry }))
  };
}

function normalizeForegroundCommand(value: string): string | undefined {
  const normalized = value.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const firstNonEmptyLine = normalized
    .split('\n')
    .map((line) => line.trim())
    .find((line) => line.length > 0);
  if (!firstNonEmptyLine) {
    return undefined;
  }

  return firstNonEmptyLine.slice(0, MAX_FOREGROUND_COMMAND_LENGTH);
}

function normalizeInboundText(value: string): string | undefined {
  const normalized = value.replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim();
  if (!normalized) {
    return undefined;
  }

  return normalized.slice(0, MAX_INBOUND_TEXT_LENGTH);
}

function isPrintableCommandCharacter(value: string): boolean {
  return value >= ' ' && value !== '\u007f';
}

function skipEscapeSequence(data: string, index: number): number {
  const next = data[index + 1];
  if (next !== '[') {
    return index;
  }

  let cursor = index + 2;
  while (cursor < data.length) {
    const current = data[cursor];
    if ((current >= 'A' && current <= 'Z') || (current >= 'a' && current <= 'z') || current === '~') {
      return cursor;
    }
    cursor += 1;
  }

  return data.length - 1;
}
