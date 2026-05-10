import type { CreateSessionOptions, TerminalControlKey } from '../../shared/terminal';
import { TerminalSessionManager } from '../terminal/terminalSessionManager';
import type { BridgeRuntimeConfig } from './bridgeConfig';

export type BridgeRequestState =
  | 'received'
  | 'queued'
  | 'running'
  | 'aborting'
  | 'completed'
  | 'failed'
  | 'rejected'
  | 'cancelled';

export type BridgeRequestKind = 'text' | 'control' | 'stop' | 'screenshot';

export interface ChannelSessionBinding {
  channelId: string;
  sessionId: string;
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
  controlKey?: TerminalControlKey;
  expectOutput: boolean;
}

export interface EnqueueRequestInput {
  channelId: string;
  kind: BridgeRequestKind;
  userId?: string;
  messageId?: string;
  content?: string;
  controlKey?: TerminalControlKey;
  expectOutput?: boolean;
}

export interface EnqueueRequestResult {
  disposition: 'running' | 'queued' | 'rejected';
  binding: ChannelSessionBinding;
  request: BridgeRequestRecord;
}

interface ChannelRecord {
  binding: ChannelSessionBinding;
  inFlight?: BridgeRequestRecord;
  queued?: BridgeRequestRecord;
}

export class ChannelSessionRegistry {
  private readonly records = new Map<string, ChannelRecord>();

  constructor(
    private readonly terminalSessionManager: TerminalSessionManager,
    private readonly config: BridgeRuntimeConfig
  ) {}

  ensureBinding(channelId: string): ChannelSessionBinding {
    this.assertAllowedChannel(channelId);

    const existing = this.records.get(channelId);
    if (existing && this.isSessionAlive(existing.binding.sessionId)) {
      return cloneBinding(existing.binding);
    }

    const createdAt = new Date().toISOString();
    const options: CreateSessionOptions = {
      mode: 'bridge',
      dimensions: this.config.bridgeDimensions
    };
    const session = this.terminalSessionManager.createSession(options);
    const binding: ChannelSessionBinding = {
      channelId,
      sessionId: session.id,
      status: 'active',
      createdAt,
      updatedAt: createdAt
    };

    this.records.set(channelId, { binding });
    return cloneBinding(binding);
  }

  enqueue(input: EnqueueRequestInput): EnqueueRequestResult {
    const channel = this.getOrCreateRecord(input.channelId);
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

  resetBinding(channelId: string): ChannelSessionBinding {
    const channel = this.getExistingRecord(channelId);
    const previousSessionId = channel.binding.sessionId;
    const replacement = this.terminalSessionManager.createSession({
      mode: 'bridge',
      dimensions: this.config.bridgeDimensions
    });
    const updatedAt = new Date().toISOString();
    channel.binding = {
      ...channel.binding,
      sessionId: replacement.id,
      status: channel.inFlight ? 'busy' : 'active',
      updatedAt
    };

    if (previousSessionId !== replacement.id && this.terminalSessionManager.hasSession(previousSessionId)) {
      this.terminalSessionManager.closeSession(previousSessionId);
    }

    return cloneBinding(channel.binding);
  }

  private getOrCreateRecord(channelId: string): ChannelRecord {
    const binding = this.ensureBinding(channelId);
    const record = this.records.get(binding.channelId);
    if (!record) {
      throw new Error(`Missing channel registry record for ${channelId}`);
    }

    return record;
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

  private assertAllowedChannel(channelId: string): void {
    if (this.config.allowChannelIds.length > 0 && !this.config.allowChannelIds.includes(channelId)) {
      throw new Error(`Channel is not allowed for bridge session binding: ${channelId}`);
    }
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
