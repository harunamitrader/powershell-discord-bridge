import net from 'node:net';
import type { TerminalSlotId, TerminalWriteSource } from '../../shared/terminal';
import { AppLogStore } from '../app/appLogStore';
import { TerminalSlotService } from '../app/terminalSlotService';
import { TerminalAutomationService } from '../bridge/terminalAutomationService';

const LOCAL_AUTOMATION_PIPE_PATH = '\\\\.\\pipe\\powershell-discord-bridge-local-automation-v1';

interface LocalAutomationSendTextRequest {
  kind: 'send-text';
  slot: TerminalSlotId;
  text: string;
  pressEnter?: boolean;
  client?: string;
}

interface LocalAutomationSuccessResponse {
  ok: true;
  kind: 'send-text';
  slot: TerminalSlotId;
  sessionId: string;
  title?: string;
  cwd?: string;
  pressEnter: boolean;
  textLength: number;
  acceptedAt: string;
}

interface LocalAutomationErrorResponse {
  ok: false;
  error: string;
}

type LocalAutomationResponse = LocalAutomationSuccessResponse | LocalAutomationErrorResponse;

export class LocalAutomationServer {
  private server?: net.Server;

  constructor(
    private readonly terminalSlotService: TerminalSlotService,
    private readonly terminalAutomationService: TerminalAutomationService,
    private readonly appLogStore?: AppLogStore
  ) {}

  start(): void {
    if (this.server) {
      return;
    }

    const server = net.createServer((socket) => {
      socket.setEncoding('utf8');
      let payload = '';

      socket.on('data', (chunk) => {
        payload += chunk;
      });

      socket.on('end', () => {
        void this.respond(socket, payload);
      });

      socket.on('error', (error) => {
        this.log(`socket error: ${formatError(error)}`);
      });
    });

    server.on('error', (error) => {
      this.log(`server error: ${formatError(error)}`);
    });

    server.listen(LOCAL_AUTOMATION_PIPE_PATH, () => {
      this.log(`started pipe=${LOCAL_AUTOMATION_PIPE_PATH}`);
    });

    this.server = server;
  }

  stop(): void {
    if (!this.server) {
      return;
    }

    this.server.close();
    this.server = undefined;
    this.log('stopped');
  }

  private async respond(socket: net.Socket, payload: string): Promise<void> {
    const response = await this.handlePayload(payload);
    socket.end(`${JSON.stringify(response)}\n`);
  }

  private async handlePayload(payload: string): Promise<LocalAutomationResponse> {
    try {
      const request = parseSendTextRequest(payload);
      const session = this.terminalSlotService.ensureSession(request.slot);
      const source: TerminalWriteSource = 'automation';

      await this.terminalAutomationService.sendInput({
        sessionId: session.id,
        content: request.text,
        appendEnter: request.pressEnter ?? true,
        source
      });

      this.log(
        `accepted kind=send-text slot=${request.slot} session=${session.id} pressEnter=${request.pressEnter ?? true} textLength=${request.text.length} client=${JSON.stringify(request.client ?? 'unknown')}`
      );

      return {
        ok: true,
        kind: 'send-text',
        slot: request.slot,
        sessionId: session.id,
        title: session.title,
        cwd: session.cwd,
        pressEnter: request.pressEnter ?? true,
        textLength: request.text.length,
        acceptedAt: new Date().toISOString()
      };
    } catch (error) {
      const message = formatError(error);
      this.log(`rejected error=${JSON.stringify(message)}`);
      return {
        ok: false,
        error: message
      };
    }
  }

  private log(message: string): void {
    this.appLogStore?.appendMessage('stdout', `[local automation] ${message}\n`);
  }
}

function parseSendTextRequest(payload: string): LocalAutomationSendTextRequest {
  const trimmedPayload = payload.trim();
  if (!trimmedPayload) {
    throw new Error('Local automation request payload is empty.');
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmedPayload);
  } catch (error) {
    throw new Error(`Invalid local automation JSON: ${formatError(error)}`);
  }

  if (!isRecord(parsed)) {
    throw new Error('Local automation request must be a JSON object.');
  }

  if (parsed.kind !== 'send-text') {
    throw new Error('Unsupported local automation request kind.');
  }

  const slot = parseSlot(parsed.slot);
  const text = typeof parsed.text === 'string' ? parsed.text : '';
  if (text.length === 0) {
    throw new Error('Text is required.');
  }

  if (typeof parsed.pressEnter !== 'undefined' && typeof parsed.pressEnter !== 'boolean') {
    throw new Error('pressEnter must be a boolean when provided.');
  }

  if (typeof parsed.client !== 'undefined' && typeof parsed.client !== 'string') {
    throw new Error('client must be a string when provided.');
  }

  return {
    kind: 'send-text',
    slot,
    text,
    pressEnter: parsed.pressEnter,
    client: parsed.client
  };
}

function parseSlot(value: unknown): TerminalSlotId {
  if (value === 1 || value === 2 || value === 3 || value === 4) {
    return value;
  }

  throw new Error('slot must be 1, 2, 3, or 4.');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
