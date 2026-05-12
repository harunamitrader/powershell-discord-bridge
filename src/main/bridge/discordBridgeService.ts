import { app, type BrowserWindow } from 'electron';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { AttachmentBuilder, ChannelType, Client, GatewayIntentBits, type Guild, type Message, type TextChannel } from 'discord.js';
import type {
  TerminalAutomationTurnResult,
  TerminalControlKey,
  TerminalSessionRenameRequest,
  TerminalSessionSummary,
  TerminalSlotId,
  TerminalSlotSettingsUpdate,
  TerminalSlotSettingsUpdateResult
} from '../../shared/terminal';
import { PreferencesStore } from '../app/preferencesStore';
import {
  ChannelSessionRegistry,
  type BridgeRequestRecord,
  type EnqueueRequestResult
} from './channelSessionRegistry';
import type { BridgeRuntimeConfig } from './bridgeConfig';
import { DiscordReplyFormatter } from './discordReplyFormatter';
import { TerminalAutomationService } from './terminalAutomationService';
import { buildWindowScreenshotFilename, captureWindowScreenshotPng } from './windowScreenshotCapture';
import { buildTerminalScreenshotFilename, captureTerminalScreenshotPng } from './terminalScreenshotCapture';
import { TerminalSessionManager } from '../terminal/terminalSessionManager';
import { TerminalSlotService } from '../app/terminalSlotService';

const REACTION_PROCESSING = '⏳';
const REACTION_QUEUED = '🕒';
const REACTION_SUCCESS = '✅';
const REACTION_FAILURE = '⚠️';
const REACTION_REJECTED = '🚫';

const STOPPED_REPLY = '[stopped]';
const STOP_REQUESTED_REPLY = '[stop requested]';
const TERMINAL_RESTARTED_REPLY = '[terminal restarted]';
const APP_RESTARTING_REPLY = '[app restarting]';
const NO_ACTIVE_REQUEST_REPLY = '[no active request]';
const QUEUE_FULL_REPLY = 'Bridge busy: one request is already running and one is already queued.';
const AUTO_SCREENSHOT_ENABLED_REPLY = '[auto screenshot after reply: enabled]';
const AUTO_SCREENSHOT_DISABLED_REPLY = '[auto screenshot after reply: disabled]';
const AUTO_SCREENSHOT_STATUS_ON_REPLY = '[auto screenshot after reply: on]';
const AUTO_SCREENSHOT_STATUS_OFF_REPLY = '[auto screenshot after reply: off]';
const AUTO_SCREENSHOT_ATTACHMENT_REPLY = '[auto screenshot after completion: terminal]';
const HARD_TIMEOUT_UNLIMITED_ENABLED_REPLY = '[hard timeout: unlimited]';
const HELP_REPLY = [
  'Bridge commands:',
  '!help',
  '!restartterminal / !rst',
  '!restartapp / !rsa',
  '!stop',
  '!enter',
  '!esc',
  '!ctrlc / !ctrl-c',
  '!screenshot / !ss',
  '!windowscreenshot / !wss',
  '!autoscreenshot',
  '!autoscreenshoton',
  '!autoscreenshotoff',
  '!hardtimeout',
  '!hardtimeoutunlimited',
  '!replyformat',
  '!replyformatcommand',
  '!replyformattext',
  '!/command -> send /command with Enter',
  '!noenterTEXT -> send TEXT without Enter'
].join('\n');

interface ProcessingLogEntry {
  requestId: string;
  messageId?: string;
  channelId: string;
  sessionId: string;
  requestState: BridgeRequestRecord['state'];
  kind: BridgeRequestRecord['kind'];
  startedAt: string;
  finishedAt: string;
  completionReason?: string;
  diffLength?: number;
  timeoutFlag: boolean;
  error?: string;
}

interface RequestContext {
  message: Message;
}

type ParsedBridgeMessage =
  | { kind: 'ignore' }
  | { kind: 'help' }
  | { kind: 'restart-terminal' }
  | { kind: 'restart-app' }
  | { kind: 'stop' }
  | { kind: 'settings'; setting: 'auto-screenshot'; value?: boolean }
  | { kind: 'settings'; setting: 'hard-timeout'; value?: number | null }
  | { kind: 'settings'; setting: 'reply-format'; value?: 'command' | 'plain-text' }
  | { kind: 'screenshot'; expectOutput: false }
  | { kind: 'window-screenshot'; expectOutput: false }
  | { kind: 'control'; key: TerminalControlKey; expectOutput: boolean }
  | { kind: 'text'; content: string; expectOutput: boolean; appendEnter?: boolean };

type BusyPassthroughMessage =
  | Extract<ParsedBridgeMessage, { kind: 'control' }>
  | Extract<ParsedBridgeMessage, { kind: 'text' }>;

interface BridgeExecutionResult {
  completionReason: string;
  success: boolean;
  replyChunks: string[];
  diffLength: number;
  attachments?: AttachmentBuilder[];
}

export class DiscordBridgeService {
  private client?: Client;
  private readonly requestContexts = new Map<string, RequestContext>();
  private readonly abortingChannels = new Set<string>();
  private readonly replyFormatter: DiscordReplyFormatter;

  constructor(
    private readonly channelSessionRegistry: ChannelSessionRegistry,
    private readonly terminalAutomationService: TerminalAutomationService,
    private readonly terminalSessionManager: TerminalSessionManager,
    private readonly terminalSlotService: TerminalSlotService,
    private readonly config: BridgeRuntimeConfig,
    private readonly getMainWindow: () => BrowserWindow | undefined,
    private readonly preferencesStore: PreferencesStore
  ) {
    this.replyFormatter = new DiscordReplyFormatter(config.reply);
  }

  async start(): Promise<void> {
    if (!this.config.discordBotToken) {
      console.info('Discord bridge is disabled because DISCORD_BOT_TOKEN is not set.');
      return;
    }

    if (this.client) {
      return;
    }

    const client = new Client({
      intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent]
    });

    const waitForReady = new Promise<void>((resolve) => {
      client.once('clientReady', () => {
        resolve();
      });
    });

    client.once('clientReady', () => {
      console.info(`Discord bridge connected as ${client.user?.tag ?? 'unknown-user'}.`);
    });

    client.on('error', (error) => {
      console.error('Discord bridge client error', error);
    });

    client.on('messageCreate', (message) => {
      void this.handleMessage(message).catch((error) => {
        console.error('Discord bridge message handling failed', error);
      });
    });

    this.client = client;
    try {
      await client.login(this.config.discordBotToken);
      await waitForReady;
    } catch (error) {
      this.client = undefined;
      throw error;
    }
  }

  stop(): void {
    this.client?.destroy();
    this.client = undefined;
    this.requestContexts.clear();
    this.abortingChannels.clear();
  }

  async ensureStartupBindings(): Promise<void> {
    for (const slot of this.terminalSlotService.listSlots()) {
      try {
        await this.ensureSlotBinding(slot.slotId);
      } catch (error) {
        console.error(`Failed to bind startup slot ${slot.slotId}`, error);
      }
    }
  }

  async restartSlot(slotId: TerminalSlotId): Promise<TerminalSessionSummary> {
    const session = this.terminalSlotService.restartSlot(slotId);
    await this.ensureSlotBinding(slotId);
    return session;
  }

  async updateTerminalSlot(update: TerminalSlotSettingsUpdate): Promise<TerminalSlotSettingsUpdateResult> {
    const currentSlot = this.terminalSlotService.getSlot(update.slotId);
    const nextWorkspaceName = update.workspaceName?.trim() ? update.workspaceName.trim() : currentSlot.workspaceName;
    const nextCwd = update.cwd?.trim() ? update.cwd.trim() : currentSlot.cwd;
    const desiredChannelId = update.channelId === undefined ? currentSlot.channelId : update.channelId.trim();

    const channel = await this.resolveDesiredChannel(update.slotId, desiredChannelId, nextWorkspaceName, nextCwd);
    const result = this.terminalSlotService.updateSlot({
      slotId: update.slotId,
      workspaceName: nextWorkspaceName,
      channelId: channel?.id ?? desiredChannelId,
      cwd: nextCwd
    });

    const session = result.session ?? this.getLiveSessionForSlot(update.slotId);
    if (session && channel) {
      this.channelSessionRegistry.registerWorkspaceBinding({
        slotId: update.slotId,
        channelId: channel.id,
        sessionId: session.id,
        workspaceName: result.slot.workspaceName
      });
    }

    return {
      slot: result.slot,
      session
    };
  }

  async renameSession(request: TerminalSessionRenameRequest): Promise<TerminalSessionSummary> {
    const slotId = this.terminalSlotService.getSlotIdBySessionId(request.sessionId);
    if (!slotId) {
      return this.terminalSessionManager.renameSession(request.sessionId, request.title);
    }
    const result = await this.updateTerminalSlot({
      slotId,
      workspaceName: request.title
    });
    return result.session ?? this.terminalSessionManager.renameSession(request.sessionId, result.slot.workspaceName);
  }

  private async handleMessage(message: Message): Promise<void> {
    if (message.author.bot) {
      return;
    }

    if (!this.isAllowedUser(message.author.id) || !this.isAllowedGuild(message.guildId)) {
      return;
    }

    const slot = this.terminalSlotService.findSlotByChannelId(message.channelId);
    if (!slot) {
      return;
    }

    await this.ensureSlotBinding(slot.slotId);

    const parsed = parseBridgeMessage(message.content, this.client?.user?.id);
    if (parsed.kind === 'ignore') {
      return;
    }

    if (parsed.kind === 'stop') {
      await this.handleStopCommand(message);
      return;
    }

    if (parsed.kind === 'help') {
      await this.handleHelpCommand(message);
      return;
    }

    if (parsed.kind === 'restart-terminal') {
      await this.handleRestartTerminalCommand(message, slot.slotId);
      return;
    }

    if (parsed.kind === 'restart-app') {
      await this.handleRestartAppCommand(message);
      return;
    }

    if (parsed.kind === 'settings') {
      await this.handleSettingsCommand(message, parsed);
      return;
    }

    const binding = this.channelSessionRegistry.getBinding(message.channelId);
    if (binding?.status === 'busy' && isBusyPassthroughMessage(parsed)) {
      await this.handleBusyPassthroughMessage(message, binding.sessionId, parsed);
      return;
    }

    const enqueueResult = this.channelSessionRegistry.enqueue({
      channelId: message.channelId,
      kind: parsed.kind,
      userId: message.author.id,
      messageId: message.id,
      content: parsed.kind === 'text' ? parsed.content : undefined,
      appendEnter: parsed.kind === 'text' ? parsed.appendEnter : undefined,
      controlKey: parsed.kind === 'control' ? parsed.key : undefined,
      expectOutput: parsed.expectOutput
    });

    this.requestContexts.set(enqueueResult.request.requestId, { message });
    await this.handleEnqueueResult(enqueueResult);
  }

  private async handleEnqueueResult(result: EnqueueRequestResult): Promise<void> {
    const context = this.requestContexts.get(result.request.requestId);
    if (!context) {
      return;
    }

    if (result.disposition === 'rejected') {
      this.requestContexts.delete(result.request.requestId);
      await this.tryAddReaction(context.message, REACTION_REJECTED);
      await this.sendReplies(context.message, this.formatReplyText(QUEUE_FULL_REPLY));
      this.persistProcessingLog({
        requestId: result.request.requestId,
        messageId: result.request.messageId,
        channelId: result.request.channelId,
        sessionId: result.binding.sessionId,
        requestState: 'rejected',
        kind: result.request.kind,
        startedAt: result.request.createdAt,
        finishedAt: new Date().toISOString(),
        timeoutFlag: false
      });
      return;
    }

    if (result.disposition === 'queued') {
      await this.tryAddReaction(context.message, REACTION_QUEUED);
      return;
    }

    await this.tryAddReaction(context.message, REACTION_PROCESSING);
    void this.processRequest(result.binding.channelId, result.request);
  }

  private async handleStopCommand(message: Message): Promise<void> {
    await this.tryAddReaction(message, REACTION_PROCESSING);

    const binding = this.channelSessionRegistry.getBinding(message.channelId);
    if (!binding) {
      await this.tryAddReaction(message, REACTION_REJECTED);
        await this.sendReplies(message, this.formatReplyText(NO_ACTIVE_REQUEST_REPLY));
      return;
    }

    let aborted: ReturnType<ChannelSessionRegistry['abortChannel']>;
    try {
      aborted = this.channelSessionRegistry.abortChannel(message.channelId);
    } catch {
      await this.tryAddReaction(message, REACTION_REJECTED);
      await this.sendReplies(message, this.formatReplyText(NO_ACTIVE_REQUEST_REPLY));
      return;
    }

    if (!aborted.running) {
      await this.tryAddReaction(message, REACTION_REJECTED);
      await this.sendReplies(message, this.formatReplyText(NO_ACTIVE_REQUEST_REPLY));
      return;
    }

    this.abortingChannels.add(message.channelId);
    this.terminalAutomationService.requestAbort(aborted.binding.sessionId);

    if (aborted.cancelled) {
      await this.cancelQueuedRequest(aborted.cancelled);
    }

    await this.tryAddReaction(message, REACTION_SUCCESS);
    await this.sendReplies(message, this.formatReplyText(STOP_REQUESTED_REPLY));
  }

  private async handleHelpCommand(message: Message): Promise<void> {
    await this.tryAddReaction(message, REACTION_SUCCESS);
    await this.sendReplies(message, this.formatReplyText(HELP_REPLY));
  }

  private async handleBusyPassthroughMessage(
    message: Message,
    sessionId: string,
    parsed: BusyPassthroughMessage
  ): Promise<void> {
    const startedAt = new Date().toISOString();

    try {
      if (parsed.kind === 'text') {
        await this.terminalAutomationService.sendInput({
          sessionId,
          content: parsed.content,
          appendEnter: parsed.appendEnter,
          source: 'bridge'
        });
      } else {
        this.terminalAutomationService.sendControlKey(sessionId, parsed.key, 'bridge');
      }

      this.persistProcessingLog({
        requestId: message.id,
        messageId: message.id,
        channelId: message.channelId,
        sessionId,
        requestState: 'forwarded',
        kind: parsed.kind,
        startedAt,
        finishedAt: new Date().toISOString(),
        timeoutFlag: false
      });
      await this.tryAddReaction(message, REACTION_SUCCESS);
    } catch (error) {
      this.persistProcessingLog({
        requestId: message.id,
        messageId: message.id,
        channelId: message.channelId,
        sessionId,
        requestState: 'failed',
        kind: parsed.kind,
        startedAt,
        finishedAt: new Date().toISOString(),
        timeoutFlag: toErrorMessage(error).includes('timeout'),
        error: toErrorMessage(error)
      });
      await this.tryAddReaction(message, REACTION_FAILURE);
      await this.sendReplies(message, this.formatReplyText(`Bridge request failed: ${toErrorMessage(error)}`));
    }
  }

  private async handleRestartTerminalCommand(message: Message, slotId: TerminalSlotId): Promise<void> {
    await this.tryAddReaction(message, REACTION_PROCESSING);

    this.terminalSlotService.restartSlot(slotId);
    await this.ensureSlotBinding(slotId);

    await this.tryAddReaction(message, REACTION_SUCCESS);
    await this.sendReplies(message, this.formatReplyText(TERMINAL_RESTARTED_REPLY));
  }

  private async handleRestartAppCommand(message: Message): Promise<void> {
    await this.tryAddReaction(message, REACTION_PROCESSING);
    await this.tryAddReaction(message, REACTION_SUCCESS);
    await this.sendReplies(message, this.formatReplyText(APP_RESTARTING_REPLY));

    setTimeout(() => {
      app.relaunch();
      app.exit(0);
    }, 500);
  }

  private async handleSettingsCommand(
    message: Message,
    parsed: Extract<ParsedBridgeMessage, { kind: 'settings' }>
  ): Promise<void> {
    const current = this.preferencesStore.getBridgeSettings();
    if (parsed.setting === 'auto-screenshot') {
      const nextValue = parsed.value;
      if (nextValue === undefined) {
        await this.tryAddReaction(message, REACTION_SUCCESS);
        await this.sendReplies(message, this.formatReplyText(current.autoScreenshotOnReply ? AUTO_SCREENSHOT_STATUS_ON_REPLY : AUTO_SCREENSHOT_STATUS_OFF_REPLY));
        return;
      }

      const updated = this.preferencesStore.setBridgeSettings({
        autoScreenshotOnReply: nextValue
      });
      await this.tryAddReaction(message, REACTION_SUCCESS);
      await this.sendReplies(message, this.formatReplyText(updated.autoScreenshotOnReply ? AUTO_SCREENSHOT_ENABLED_REPLY : AUTO_SCREENSHOT_DISABLED_REPLY));
      return;
    }

    if (parsed.setting === 'reply-format') {
      const nextValue = parsed.value;
      if (nextValue === undefined) {
        await this.tryAddReaction(message, REACTION_SUCCESS);
        await this.sendReplies(message, this.formatReplyText(`[reply format: ${formatReplyFormat(current.replyFormat)}]`));
        return;
      }

      const updated = this.preferencesStore.setBridgeSettings({
        replyFormat: nextValue
      });
      await this.tryAddReaction(message, REACTION_SUCCESS);
      await this.sendReplies(message, this.formatReplyText(`[reply format: ${formatReplyFormat(updated.replyFormat)}]`));
      return;
    }

    const nextValue = parsed.value;
    if (nextValue === undefined) {
      await this.tryAddReaction(message, REACTION_SUCCESS);
      await this.sendReplies(message, this.formatReplyText(`[hard timeout: ${formatHardTimeout(current.hardTimeoutMs)}]`));
      return;
    }

    const updated = this.preferencesStore.setBridgeSettings({
      hardTimeoutMs: nextValue
    });
    await this.tryAddReaction(message, REACTION_SUCCESS);
    await this.sendReplies(
      message,
      this.formatReplyText(updated.hardTimeoutMs === null ? HARD_TIMEOUT_UNLIMITED_ENABLED_REPLY : `[hard timeout: ${formatHardTimeout(updated.hardTimeoutMs)}]`)
    );
  }

  private async processRequest(channelId: string, request: BridgeRequestRecord): Promise<void> {
    const context = this.requestContexts.get(request.requestId);
    if (!context) {
      return;
    }

    let binding = this.channelSessionRegistry.getBinding(channelId);
    if (!binding) {
      const slot = this.terminalSlotService.findSlotByChannelId(channelId);
      if (!slot) {
        throw new Error(`Unbound Discord channel: ${channelId}`);
      }

      await this.ensureSlotBinding(slot.slotId);
      binding = this.channelSessionRegistry.getBinding(channelId);
      if (!binding) {
        throw new Error(`Failed to bind Discord channel: ${channelId}`);
      }
    }

    await this.setInputLock(binding.sessionId, true);
    let skipUnlock = false;

    try {
      const result = await this.executeRequest(binding.sessionId, request);
      const aborted = this.abortingChannels.has(channelId) || result.completionReason === 'aborted';

      if (aborted) {
        await this.sendReplies(context.message, this.formatReplyText(STOPPED_REPLY));
        await this.tryAddReaction(context.message, REACTION_REJECTED);
      } else if (!result.success) {
        throw new Error(`completion=${result.completionReason}`);
      } else {
        await this.sendReplies(context.message, result.replyChunks, result.attachments);
        await this.maybeSendAutoScreenshot(context.message, request, binding.sessionId);
        await this.tryAddReaction(context.message, REACTION_SUCCESS);
      }

      this.persistProcessingLog({
        requestId: request.requestId,
        messageId: request.messageId,
        channelId,
        sessionId: binding.sessionId,
        requestState: aborted ? 'cancelled' : 'completed',
        kind: request.kind,
        startedAt: request.createdAt,
        finishedAt: new Date().toISOString(),
        completionReason: result.completionReason,
        diffLength: result.diffLength,
        timeoutFlag: result.completionReason.includes('timeout')
      });
      await this.finishSuccessfulRequest(channelId, binding.sessionId, request.requestId, { skipUnlock });
    } catch (error) {
      await this.finishFailedRequest(channelId, binding.sessionId, request, error, { skipUnlock });
    }
  }

  private async executeRequest(sessionId: string, request: BridgeRequestRecord): Promise<BridgeExecutionResult> {
    if (request.kind === 'text') {
      return this.mapAutomationResult(
        await this.terminalAutomationService.runAutomationTurn({
          sessionId,
          kind: 'text',
          content: request.content ?? '',
          appendEnter: request.appendEnter,
          expectOutput: request.expectOutput
        })
      );
    }

    if (request.kind === 'control') {
      return this.mapAutomationResult(
        await this.terminalAutomationService.runAutomationTurn({
          sessionId,
          kind: 'control',
          key: request.controlKey ?? 'enter',
          expectOutput: request.expectOutput
        })
      );
    }

    if (request.kind === 'screenshot') {
      const capturedAt = new Date().toISOString();
      const attachment = new AttachmentBuilder(await captureTerminalScreenshotPng(sessionId), {
        name: buildTerminalScreenshotFilename(capturedAt)
      });
      return {
        completionReason: 'snapshot_captured',
        success: true,
        replyChunks: ['[terminal screenshot]'],
        diffLength: 0,
        attachments: [attachment]
      };
    }

    if (request.kind === 'window-screenshot') {
      const mainWindow = this.getMainWindow();
      if (!mainWindow) {
        throw new Error('Main window is not available for screenshot capture.');
      }

      const capturedAt = new Date().toISOString();
      const attachment = new AttachmentBuilder(await captureWindowScreenshotPng(mainWindow), {
        name: buildWindowScreenshotFilename(capturedAt)
      });
      return {
        completionReason: 'snapshot_captured',
        success: true,
        replyChunks: ['[app window screenshot]'],
        diffLength: 0,
        attachments: [attachment]
      };
    }

    throw new Error(`Unsupported request kind: ${request.kind}`);
  }

  private mapAutomationResult(result: TerminalAutomationTurnResult): BridgeExecutionResult {
    return {
      completionReason: result.completion.reason,
      success: result.completion.success,
      replyChunks: result.replyChunks,
      diffLength: result.diff.diffText.length
    };
  }

  private async maybeSendAutoScreenshot(message: Message, request: BridgeRequestRecord, sessionId: string): Promise<void> {
    if (request.kind === 'screenshot' || request.kind === 'window-screenshot') {
      return;
    }

    if (!this.preferencesStore.getBridgeSettings().autoScreenshotOnReply) {
      return;
    }

    const capturedAt = new Date().toISOString();
    const attachment = new AttachmentBuilder(await captureTerminalScreenshotPng(sessionId), {
      name: buildTerminalScreenshotFilename(capturedAt)
    });
    await this.sendReplies(message, this.formatReplyText(AUTO_SCREENSHOT_ATTACHMENT_REPLY), [attachment]);
  }

  private async finishSuccessfulRequest(
    channelId: string,
    sessionId: string,
    requestId: string,
    options?: { skipUnlock?: boolean }
  ): Promise<void> {
    this.requestContexts.delete(requestId);
    this.terminalAutomationService.clearAbort(sessionId);
    this.abortingChannels.delete(channelId);

    const transition = this.channelSessionRegistry.markRunningCompleted(channelId);
    if (!transition.nextRequest) {
      if (!options?.skipUnlock) {
        await this.setInputLock(sessionId, false);
      }
      return;
    }

    const nextContext = this.requestContexts.get(transition.nextRequest.requestId);
    if (nextContext) {
      await this.tryAddReaction(nextContext.message, REACTION_PROCESSING);
    }

    void this.processRequest(channelId, transition.nextRequest);
  }

  private async finishFailedRequest(
    channelId: string,
    sessionId: string,
    request: BridgeRequestRecord,
    error: unknown,
    options?: { skipUnlock?: boolean }
  ): Promise<void> {
    const context = this.requestContexts.get(request.requestId);
    this.requestContexts.delete(request.requestId);
    this.terminalAutomationService.clearAbort(sessionId);
    this.abortingChannels.delete(channelId);

    const transition = this.channelSessionRegistry.failRunning(channelId);
    if (transition.cancelled) {
      await this.cancelQueuedRequest(transition.cancelled);
    }

    if (!options?.skipUnlock) {
      await this.setInputLock(sessionId, false);
    }

    if (!context) {
      return;
    }

    this.persistProcessingLog({
      requestId: request.requestId,
      messageId: request.messageId ?? context.message.id,
      channelId,
      sessionId,
      requestState: 'failed',
      kind: request.kind,
      startedAt: request.createdAt,
      finishedAt: new Date().toISOString(),
      timeoutFlag: toErrorMessage(error).includes('timeout'),
      error: toErrorMessage(error)
    });
    await this.tryAddReaction(context.message, REACTION_FAILURE);
    await this.sendReplies(context.message, this.formatReplyText(`Bridge request failed: ${toErrorMessage(error)}`));
  }

  private async cancelQueuedRequest(request: BridgeRequestRecord): Promise<void> {
    const context = this.requestContexts.get(request.requestId);
    this.requestContexts.delete(request.requestId);
    this.persistProcessingLog({
      requestId: request.requestId,
      messageId: request.messageId,
      channelId: request.channelId,
      sessionId: this.channelSessionRegistry.getBinding(request.channelId)?.sessionId ?? 'unknown',
      requestState: 'cancelled',
      kind: request.kind,
      startedAt: request.createdAt,
      finishedAt: new Date().toISOString(),
      timeoutFlag: false
    });
    if (!context) {
      return;
    }

    await this.tryAddReaction(context.message, REACTION_REJECTED);
  }

  private persistProcessingLog(entry: ProcessingLogEntry): void {
    mkdirSync(this.config.storage.processingLogDirectory, { recursive: true });
    const filename = `${entry.finishedAt.replace(/[:.]/g, '-')}-${entry.requestId}.json`;
    const filePath = path.join(this.config.storage.processingLogDirectory, filename);
    writeFileSync(filePath, JSON.stringify(entry, null, 2), 'utf8');
  }

  private async tryAddReaction(message: Message, emoji: string): Promise<void> {
    try {
      await message.react(emoji);
    } catch (error) {
      console.warn(`Discord reaction failed for message ${message.id}`, error);
    }
  }

  private async sendReplies(message: Message, chunks: string[], attachments?: AttachmentBuilder[]): Promise<void> {
    if (chunks.length === 0 && attachments && attachments.length > 0) {
      await message.reply({
        files: attachments,
        allowedMentions: {
          repliedUser: false
        }
      });
      return;
    }

    for (const [index, chunk] of chunks.entries()) {
      await message.reply({
        content: chunk,
        files: index === 0 ? attachments : undefined,
        allowedMentions: {
          repliedUser: false
        }
      });
    }
  }

  private formatReplyText(text: string): string[] {
    return this.replyFormatter.format(text, this.preferencesStore.getBridgeSettings().replyFormat);
  }

  private async setInputLock(sessionId: string, locked: boolean): Promise<void> {
    try {
      await Promise.resolve(this.terminalAutomationService.setInputLock(sessionId, locked));
    } catch (error) {
      console.warn(`Failed to update input lock for session ${sessionId}`, error);
    }
  }

  private isAllowedUser(userId: string): boolean {
    return this.config.allowUserIds.length === 0 || this.config.allowUserIds.includes(userId);
  }

  private isAllowedGuild(guildId: string | null): boolean {
    if (!guildId) {
      return false;
    }

    return !this.config.guildId || this.config.guildId === guildId;
  }

  private async ensureSlotBinding(slotId: TerminalSlotId): Promise<void> {
    const slot = this.terminalSlotService.getSlot(slotId);
    const session = this.terminalSlotService.ensureSession(slotId);
    const channel = await this.resolveDesiredChannel(slotId, slot.channelId, slot.workspaceName, slot.cwd);
    const finalChannelId = channel?.id ?? slot.channelId;
    if (finalChannelId !== slot.channelId) {
      this.terminalSlotService.updateSlot({
        slotId,
        channelId: finalChannelId
      });
    }

    if (!finalChannelId) {
      console.warn(`No Discord channel is bound for slot ${slotId}.`);
      return;
    }

    this.channelSessionRegistry.registerWorkspaceBinding({
      slotId,
      channelId: finalChannelId,
      sessionId: session.id,
      workspaceName: slot.workspaceName
    });
    console.info(`Bound slot ${slotId} to Discord channel ${finalChannelId}.`);
  }

  private getLiveSessionForSlot(slotId: TerminalSlotId): TerminalSessionSummary | undefined {
    const sessionId = this.terminalSlotService.getSessionIdForSlot(slotId);
    if (!sessionId) {
      return undefined;
    }

    return this.terminalSessionManager.listSessions().find((session) => session.id === sessionId);
  }

  private async resolveDesiredChannel(
    slotId: TerminalSlotId,
    channelId: string,
    workspaceName: string,
    cwd: string
  ): Promise<TextChannel | undefined> {
    if (!this.client?.isReady()) {
      return undefined;
    }

    const channelName = normalizeWorkspaceChannelName(workspaceName);
    const desiredTopic = buildWorkspaceChannelTopic(slotId, workspaceName, cwd);
    const existing = channelId ? await this.fetchGuildTextChannel(channelId) : undefined;

    if (existing) {
      if (this.config.guildId && existing.guildId !== this.config.guildId) {
        throw new Error(`Configured guild ${this.config.guildId} does not match channel ${channelId}.`);
      }

      if (existing.name !== channelName || existing.topic !== desiredTopic) {
        await existing.edit({
          name: channelName,
          topic: desiredTopic
        });
      }
      return existing;
    }

    const guild = await this.resolveTargetGuildForSlot(channelId);
    if (!guild) {
      return undefined;
    }

    return guild.channels.create({
      name: channelName,
      type: ChannelType.GuildText,
      topic: desiredTopic
    });
  }

  private async fetchGuildTextChannel(channelId: string): Promise<TextChannel | undefined> {
    const channel = await this.client?.channels.fetch(channelId);
    if (!channel || channel.type !== ChannelType.GuildText) {
      return undefined;
    }

    return channel as TextChannel;
  }

  private async resolveTargetGuildForSlot(existingChannelId: string): Promise<Guild | undefined> {
    if (!this.client?.isReady()) {
      return undefined;
    }

    if (this.config.guildId) {
      return this.client.guilds.fetch(this.config.guildId);
    }

    if (existingChannelId) {
      const existingChannel = await this.fetchGuildTextChannel(existingChannelId);
      if (existingChannel) {
        return this.client.guilds.fetch(existingChannel.guildId);
      }
    }

    const guilds = [...this.client.guilds.cache.values()];
    if (guilds.length === 1) {
      return guilds[0];
    }

    if (guilds.length === 0) {
      return undefined;
    }

    throw new Error('Discord channel auto-creation requires ALLOW_GUILD_ID when the bot belongs to multiple guilds.');
  }

}

export function parseBridgeMessage(content: string, botUserId?: string): ParsedBridgeMessage {
  const normalizedForCommand = stripBotMentions(content, botUserId).replace(/\r\n/g, '\n');
  const trimmedForCommand = normalizedForCommand.trim();
  const normalizedLower = trimmedForCommand.toLowerCase();
  const autoScreenshotCommand = parseAutoScreenshotCommand(normalizedLower);
  if (autoScreenshotCommand) {
    return autoScreenshotCommand;
  }

  switch (normalizedLower) {
    case '!ctrlc':
    case '!ctrl-c':
    case '[[terminal:ctrl-c]]':
      return { kind: 'control', key: 'ctrl-c', expectOutput: false };
    case '!esc':
    case '[[terminal:esc]]':
      return { kind: 'control', key: 'esc', expectOutput: false };
    case '!enter':
    case '[[terminal:enter]]':
      return { kind: 'control', key: 'enter', expectOutput: false };
    case '!screenshot':
    case '!ss':
    case '[[terminal:screenshot]]':
      return { kind: 'screenshot', expectOutput: false };
    case '!windowscreenshot':
    case '!wss':
    case '[[terminal:window-screenshot]]':
      return { kind: 'window-screenshot', expectOutput: false };
    case '!help':
    case '[[terminal:help]]':
      return { kind: 'help' };
    case '!restartterminal':
    case '!rst':
    case '[[terminal:restart-terminal]]':
      return { kind: 'restart-terminal' };
    case '!restartapp':
    case '!rsa':
    case '[[terminal:restart-app]]':
      return { kind: 'restart-app' };
    case '!stop':
    case '[[terminal:stop]]':
      return { kind: 'stop' };
  }

  const noEnterCommand = parseNoEnterCommand(normalizedForCommand);
  if (noEnterCommand) {
    return noEnterCommand;
  }

  const slashEscapeCommand = parseSlashEscapeCommand(normalizedForCommand);
  if (slashEscapeCommand) {
    return slashEscapeCommand;
  }

  const normalizedText = normalizeBridgeText(content, botUserId);
  if (normalizedText.length === 0) {
    return { kind: 'ignore' };
  }

  return {
    kind: 'text',
    content: normalizedText,
    expectOutput: true
  };
}

function parseNoEnterCommand(content: string): Extract<ParsedBridgeMessage, { kind: 'text' }> | null {
  const leftTrimmed = content.trimStart();
  const prefix = '!noenter';
  if (!leftTrimmed.toLowerCase().startsWith(prefix)) {
    return null;
  }

  return {
    kind: 'text',
    content: leftTrimmed.slice(prefix.length),
    appendEnter: false,
    expectOutput: true
  };
}

function parseSlashEscapeCommand(content: string): Extract<ParsedBridgeMessage, { kind: 'text' }> | null {
  const leftTrimmed = content.trimStart();
  if (!leftTrimmed.startsWith('!/') || leftTrimmed.length <= 2 || /\s/.test(leftTrimmed[2] ?? '')) {
    return null;
  }

  return {
    kind: 'text',
    content: leftTrimmed.slice(1),
    appendEnter: true,
    expectOutput: true
  };
}

function parseAutoScreenshotCommand(content: string): Extract<ParsedBridgeMessage, { kind: 'settings' }> | null {
  switch (content) {
    case '!autoscreenshot':
    case '[[terminal:auto-screenshot]]':
      return { kind: 'settings', setting: 'auto-screenshot' };
    case '!autoscreenshoton':
    case '[[terminal:auto-screenshot:on]]':
      return { kind: 'settings', setting: 'auto-screenshot', value: true };
    case '!autoscreenshotoff':
    case '[[terminal:auto-screenshot:off]]':
      return { kind: 'settings', setting: 'auto-screenshot', value: false };
    default:
      return parseHardTimeoutCommand(content);
  }
}

function parseHardTimeoutCommand(content: string): Extract<ParsedBridgeMessage, { kind: 'settings' }> | null {
  switch (content) {
    case '!hardtimeout':
    case '[[terminal:hard-timeout]]':
      return { kind: 'settings', setting: 'hard-timeout' };
    case '!hardtimeoutunlimited':
    case '!hardtimeoutoff':
    case '[[terminal:hard-timeout:unlimited]]':
      return { kind: 'settings', setting: 'hard-timeout', value: null };
    default:
      return parseReplyFormatCommand(content);
  }
}

function parseReplyFormatCommand(content: string): Extract<ParsedBridgeMessage, { kind: 'settings' }> | null {
  switch (content) {
    case '!replyformat':
    case '[[terminal:reply-format]]':
      return { kind: 'settings', setting: 'reply-format' };
    case '!replyformatcommand':
    case '[[terminal:reply-format:command]]':
      return { kind: 'settings', setting: 'reply-format', value: 'command' };
    case '!replyformattext':
    case '[[terminal:reply-format:text]]':
      return { kind: 'settings', setting: 'reply-format', value: 'plain-text' };
    default:
      return null;
  }
}

function isBusyPassthroughMessage(parsed: ParsedBridgeMessage): parsed is BusyPassthroughMessage {
  return parsed.kind === 'text' || parsed.kind === 'control';
}

function normalizeWorkspaceChannelName(value: string): string {
  const normalized = value
    .trim()
    .normalize('NFKC')
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^\p{Letter}\p{Number}-]+/gu, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 100);

  if (!normalized) {
    throw new Error('Workspace name must contain at least one letter or number.');
  }

  return normalized;
}

function buildWorkspaceChannelTopic(slotId: TerminalSlotId, workspaceName: string, cwd: string): string {
  return `PowerShell Discord Bridge slot ${slotId}: "${workspaceName}" (${cwd})`;
}

export function normalizeBridgeText(content: string, botUserId?: string): string {
  const withoutMentions = stripBotMentions(content, botUserId).replace(/\r\n/g, '\n');
  const withoutCodeFences = withoutMentions.replace(/```[^\n]*\n?([\s\S]*?)```/g, '$1');
  return withoutCodeFences.trim();
}

function stripBotMentions(content: string, botUserId?: string): string {
  if (!botUserId) {
    return content;
  }

  return content.replace(new RegExp(`<@!?${escapeRegExp(botUserId)}>`, 'g'), '');
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function wrapCodeBlock(text: string): string {
  return `\`\`\`text\n${text.replace(/```/g, '``\u200b`')}\n\`\`\``;
}

function formatHardTimeout(value: number | null): string {
  return value === null ? 'unlimited' : `${value} ms`;
}

function formatReplyFormat(value: 'command' | 'plain-text'): string {
  return value === 'plain-text' ? 'plain text' : 'command';
}

function toErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}
