import type { TerminalControlKey, TerminalSlotId } from '../../shared/terminal';
import { TerminalSessionManager } from '../terminal/terminalSessionManager';
import type { SavedDiscordAttachmentBatch } from './discordAttachmentService';

export type BridgeRequestState =
  | 'received'
  | 'queued'
  | 'running'
  | 'aborting'
  | 'forwarded'
  | 'completed'
  | 'failed'
  | 'rejected'
  | 'cancelled';

export type BridgeRequestKind = 'text' | 'control' | 'stop' | 'screenshot' | 'window-screenshot';

export interface ChannelSessionBinding {
  slotId: TerminalSlotId;
  channelId: string;
  sessionId: string;
  source: 'discord' | 'workspace';
  workspaceName?: string;
  status: 'active' | 'busy' | 'dead';
  createdAt: string;
  updatedAt: string;
}

export interface BridgeRequestRecord {
  requestId: string;
  channelId: string;
  state: BridgeRequestState;
  kind: BridgeRequestKind;
  createdAt: string;
  updatedAt: string;
  userId?: string;
  messageId?: string;
  content?: string;
  attachmentBatch?: SavedDiscordAttachmentBatch;
  appendEnter?: boolean;
  controlKey?: TerminalControlKey;
  expectOutput: boolean;
}

export interface EnqueueRequestInput {
  channelId: string;
  kind: BridgeRequestKind;
  userId?: string;
  messageId?: string;
  content?: string;
  attachmentBatch?: SavedDiscordAttachmentBatch;
  appendEnter?: boolean;
  controlKey?: TerminalControlKey;
  expectOutput?: boolean;
}

export interface EnqueueRequestResult {
  disposition: 'running' | 'queued' | 'rejected';
  binding: ChannelSessionBinding;
  request: BridgeRequestRecord;
}

export interface WorkspaceBindingResult {
  binding: ChannelSessionBinding;
  session: ReturnType<TerminalSessionManager['createSession']>;
}

interface ChannelRecord {
  binding: ChannelSessionBinding;
  inFlight?: BridgeRequestRecord;
  queued?: BridgeRequestRecord;
}

export class ChannelSessionRegistry {
  private readonly records = new Map<string, ChannelRecord>();
  private readonly slotChannels = new Map<TerminalSlotId, string>();

  constructor(private readonly terminalSessionManager: TerminalSessionManager) {}

  registerWorkspaceBinding(input: {
    slotId: TerminalSlotId;
    channelId: string;
    sessionId: string;
    workspaceName: string;
  }): ChannelSessionBinding {
    const existingChannelId = this.slotChannels.get(input.slotId);
    if (existingChannelId && existingChannelId !== input.channelId) {
      this.records.delete(existingChannelId);
    }

    const existingRecord = this.records.get(input.channelId);
    const timestamp = new Date().toISOString();
    const binding: ChannelSessionBinding = {
      slotId: input.slotId,
      channelId: input.channelId,
      sessionId: input.sessionId,
      source: 'workspace',
      workspaceName: input.workspaceName,
      status: existingRecord?.binding.status ?? 'active',
      createdAt: existingRecord?.binding.createdAt ?? timestamp,
      updatedAt: timestamp
    };

    this.records.set(input.channelId, {
      binding,
      inFlight: existingRecord?.inFlight,
      queued: existingRecord?.queued
    });
    this.slotChannels.set(input.slotId, input.channelId);
    return cloneBinding(binding);
  }

  rebindSession(slotId: TerminalSlotId, sessionId: string): ChannelSessionBinding | undefined {
    const channelId = this.slotChannels.get(slotId);
    if (!channelId) {
      return undefined;
    }

    const record = this.getExistingRecord(channelId);
    record.binding.sessionId = sessionId;
    record.binding.status = record.inFlight ? 'busy' : 'active';
    record.binding.updatedAt = new Date().toISOString();
    return cloneBinding(record.binding);
  }

  enqueue(input: EnqueueRequestInput): EnqueueRequestResult {
    const channel = this.getExistingRecord(input.channelId);
    const request = createRequest(input);

    if (!channel.inFlight) {
      request.state = 'running';
      request.updatedAt = new Date().toISOString();
      channel.inFlight = request;
      channel.binding.status = 'busy';
      channel.binding.updatedAt = request.updatedAt;
      return {
        disposition: 'running',
        binding: cloneBinding(channel.binding),
        request: cloneRequest(request)
      };
    }

    if (!channel.queued) {
      request.state = 'queued';
      request.updatedAt = new Date().toISOString();
      channel.queued = request;
      channel.binding.updatedAt = request.updatedAt;
      return {
        disposition: 'queued',
        binding: cloneBinding(channel.binding),
        request: cloneRequest(request)
      };
    }

    request.state = 'rejected';
    request.updatedAt = new Date().toISOString();
    return {
      disposition: 'rejected',
      binding: cloneBinding(channel.binding),
      request
    };
  }

  markRunningCompleted(channelId: string): { binding: ChannelSessionBinding; nextRequest?: BridgeRequestRecord } {
    const channel = this.getExistingRecord(channelId);
    if (!channel.inFlight) {
      return {
        binding: cloneBinding(channel.binding)
      };
    }

    channel.inFlight.state = 'completed';
    channel.inFlight.updatedAt = new Date().toISOString();
    channel.inFlight = undefined;

    if (channel.queued) {
      channel.inFlight = {
        ...channel.queued,
        state: 'running',
        updatedAt: new Date().toISOString()
      };
      channel.queued = undefined;
      channel.binding.status = 'busy';
      channel.binding.updatedAt = channel.inFlight.updatedAt;
      return {
        binding: cloneBinding(channel.binding),
        nextRequest: cloneRequest(channel.inFlight)
      };
    }

    channel.binding.status = 'active';
    channel.binding.updatedAt = new Date().toISOString();
    return {
      binding: cloneBinding(channel.binding)
    };
  }

  failRunning(channelId: string): { binding: ChannelSessionBinding; cancelled?: BridgeRequestRecord } {
    const channel = this.getExistingRecord(channelId);
    if (channel.inFlight) {
      channel.inFlight.state = 'failed';
      channel.inFlight.updatedAt = new Date().toISOString();
      channel.inFlight = undefined;
    }

    const cancelled = this.cancelQueued(channel);
    channel.binding.status = 'active';
    channel.binding.updatedAt = new Date().toISOString();
    return {
      binding: cloneBinding(channel.binding),
      cancelled
    };
  }

  abortChannel(channelId: string): { binding: ChannelSessionBinding; running?: BridgeRequestRecord; cancelled?: BridgeRequestRecord } {
    const channel = this.getExistingRecord(channelId);
    if (channel.inFlight) {
      channel.inFlight.state = 'aborting';
      channel.inFlight.updatedAt = new Date().toISOString();
    }

    const cancelled = this.cancelQueued(channel);
    channel.binding.status = 'busy';
    channel.binding.updatedAt = new Date().toISOString();
    return {
      binding: cloneBinding(channel.binding),
      running: channel.inFlight ? cloneRequest(channel.inFlight) : undefined,
      cancelled
    };
  }

  markSessionExited(sessionId: string): void {
    for (const channel of this.records.values()) {
      if (channel.binding.sessionId !== sessionId) {
        continue;
      }

      channel.binding.status = 'dead';
      channel.binding.updatedAt = new Date().toISOString();
      if (channel.inFlight) {
        channel.inFlight.state = 'failed';
        channel.inFlight.updatedAt = channel.binding.updatedAt;
      }
      if (channel.queued) {
        channel.queued.state = 'cancelled';
        channel.queued.updatedAt = channel.binding.updatedAt;
        channel.queued = undefined;
      }
    }
  }

  getBinding(channelId: string): ChannelSessionBinding | undefined {
    const channel = this.records.get(channelId);
    return channel ? cloneBinding(channel.binding) : undefined;
  }

  getBindingBySlotId(slotId: TerminalSlotId): ChannelSessionBinding | undefined {
    const channelId = this.slotChannels.get(slotId);
    if (!channelId) {
      return undefined;
    }

    return this.getBinding(channelId);
  }

  getBindingBySessionId(sessionId: string): ChannelSessionBinding | undefined {
    for (const channel of this.records.values()) {
      if (channel.binding.sessionId === sessionId) {
        return cloneBinding(channel.binding);
      }
    }

    return undefined;
  }

  updateWorkspaceName(sessionId: string, workspaceName: string): ChannelSessionBinding {
    for (const channel of this.records.values()) {
      if (channel.binding.sessionId !== sessionId) {
        continue;
      }

      channel.binding.workspaceName = workspaceName;
      channel.binding.updatedAt = new Date().toISOString();
      return cloneBinding(channel.binding);
    }

    throw new Error(`Unknown workspace binding for session: ${sessionId}`);
  }

  resetBinding(channelId: string): ChannelSessionBinding {
    const channel = this.getExistingRecord(channelId);
    const previousSessionId = channel.binding.sessionId;
    const slotId = channel.binding.slotId;
    const replacement = this.terminalSessionManager.createSession({
      slotId,
      title: channel.binding.workspaceName,
      mode: 'bridge',
      dimensions: this.terminalSessionManager.getBridgeDimensions()
    });
    const titledReplacement =
      channel.binding.source === 'workspace' && channel.binding.workspaceName
        ? this.terminalSessionManager.renameSession(replacement.id, channel.binding.workspaceName)
        : replacement;
    const updatedAt = new Date().toISOString();
    channel.binding = {
      ...channel.binding,
      sessionId: titledReplacement.id,
      status: channel.inFlight ? 'busy' : 'active',
      updatedAt
    };

    if (previousSessionId !== titledReplacement.id && this.terminalSessionManager.hasSession(previousSessionId)) {
      this.terminalSessionManager.closeSession(previousSessionId);
    }

    return cloneBinding(channel.binding);
  }

  private getExistingRecord(channelId: string): ChannelRecord {
    const record = this.records.get(channelId);
    if (!record) {
      throw new Error(`Unknown channel binding: ${channelId}`);
    }

    return record;
  }

  private cancelQueued(channel: ChannelRecord): BridgeRequestRecord | undefined {
    if (!channel.queued) {
      return undefined;
    }

    channel.queued.state = 'cancelled';
    channel.queued.updatedAt = new Date().toISOString();
    const cancelled = cloneRequest(channel.queued);
    channel.queued = undefined;
    return cancelled;
  }

  private isSessionAlive(sessionId: string): boolean {
    return this.terminalSessionManager.hasSession(sessionId);
  }

}

function createRequest(input: EnqueueRequestInput): BridgeRequestRecord {
  const timestamp = new Date().toISOString();
  return {
    requestId: `bridge-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    channelId: input.channelId,
    state: 'received',
    kind: input.kind,
    createdAt: timestamp,
    updatedAt: timestamp,
    userId: input.userId,
    messageId: input.messageId,
    content: input.content,
    attachmentBatch: input.attachmentBatch,
    appendEnter: input.appendEnter,
    controlKey: input.controlKey,
    expectOutput: input.expectOutput ?? input.kind === 'text'
  };
}

function cloneBinding(binding: ChannelSessionBinding): ChannelSessionBinding {
  return { ...binding };
}

function cloneRequest(request: BridgeRequestRecord): BridgeRequestRecord {
  return { ...request };
}
