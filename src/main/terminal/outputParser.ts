export interface ParsedTerminalOutput {
  cleanData: string;
  cwd?: string;
  promptReady?: boolean;
}

const OSC_SEQUENCE_PREFIX = '\u001b]633;';
const OSC_SEQUENCE_SUFFIX = '\u0007';

export class TerminalOutputParser {
  private buffer = '';

  parse(chunk: string): ParsedTerminalOutput {
    this.buffer += chunk;

    let cursor = 0;
    let cleanData = '';
    let cwd: string | undefined;
    let promptReady = false;

    while (true) {
      const start = this.buffer.indexOf(OSC_SEQUENCE_PREFIX, cursor);
      if (start === -1) {
        break;
      }

      const end = this.buffer.indexOf(OSC_SEQUENCE_SUFFIX, start);
      if (end === -1) {
        break;
      }

      cleanData += this.buffer.slice(cursor, start);
      const payload = this.buffer.slice(start + OSC_SEQUENCE_PREFIX.length, end);

      if (payload === 'A') {
        promptReady = true;
      } else if (payload.startsWith('P;Cwd=')) {
        const encoded = payload.slice('P;Cwd='.length);
        try {
          cwd = Buffer.from(encoded, 'base64').toString('utf8');
        } catch {
          cwd = undefined;
        }
      }

      cursor = end + OSC_SEQUENCE_SUFFIX.length;
    }

    const remainder = this.buffer.slice(cursor);
    const incompleteStart = remainder.indexOf(OSC_SEQUENCE_PREFIX);

    if (incompleteStart === -1) {
      cleanData += remainder;
      this.buffer = '';
    } else {
      cleanData += remainder.slice(0, incompleteStart);
      this.buffer = remainder.slice(incompleteStart);
    }

    return {
      cleanData,
      cwd,
      promptReady
    };
  }
}
