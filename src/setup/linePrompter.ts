/**
 * Line-based setup prompter (readline). Used for piped input and terminal secret tests.
 */
import readline from 'readline';
import { Writable } from 'stream';
import { formatEnterDefault, formatEnterKeep, warn } from './terminal.js';

const CRLF_DELAY_MS = 100;
const SUSPEND_FALLBACK_MS = 250;

export class InputEnded extends Error {}

export interface AskOptions {
  fallback?: string;
  secret?: boolean;
}

export interface SetupPrompter {
  readonly interactive: boolean;
  readonly usesClack: boolean;
  ask(question: string, options?: AskOptions): Promise<string>;
  askValid(question: string, check: (raw: string) => import('./validate.js').Check, options?: AskOptions): Promise<string>;
  confirm(question: string, defaultYes: boolean): Promise<boolean>;
  choose(question: string, labels: string[], defaultIndex: number): Promise<number>;
  chooseProvider(
    entries: import('./providerPick.js').ProviderMenuEntry[],
    defaultIndex: number,
    localDet: import('./providerPick.js').LocalDetection,
  ): Promise<number>;
  close(): void;
}

function setRawMode(enabled: boolean): void {
  if (typeof process.stdin.setRawMode === 'function') process.stdin.setRawMode(enabled);
}

export class LineSetupPrompter implements SetupPrompter {
  readonly usesClack = false;
  private rl: readline.Interface;
  private readonly queue: string[] = [];
  private readonly waiting: Array<(line: string | null) => void> = [];
  private closed = false;
  private muted = false;
  private lastReturnAt: number | undefined;
  private ignoreLineFeed = false;
  readonly interactive = Boolean(process.stdin.isTTY);

  private readonly handleKeypress = (_text: string, key: readline.Key): void => {
    const now = Date.now();
    this.ignoreLineFeed = key?.sequence === '\n' && this.lastReturnAt !== undefined && now - this.lastReturnAt <= CRLF_DELAY_MS;
    this.lastReturnAt = key?.sequence === '\r' ? now : undefined;
  };

  private readonly handleClose = (): void => {
    process.stdin.off('keypress', this.handleKeypress);
    this.closed = true;
    for (const next of this.waiting.splice(0)) next(null);
  };

  constructor(private readonly onCancel: () => void) {
    this.rl = this.createReadline();
    if (this.interactive) process.stdin.prependListener('keypress', this.handleKeypress);
  }

  private createReadline(): readline.Interface {
    let active = true;
    const output = new Writable({
      write: (chunk: Buffer, _encoding, callback) => {
        if (active && !this.muted) process.stdout.write(chunk);
        callback();
      },
    });
    const rl = readline.createInterface({
      input: process.stdin,
      output,
      terminal: this.interactive,
      historySize: 0,
      crlfDelay: CRLF_DELAY_MS,
    });
    rl.on('line', (line) => {
      if (this.ignoreLineFeed) {
        this.ignoreLineFeed = false;
        return;
      }
      const next = this.waiting.shift();
      if (next) next(line);
      else this.queue.push(line);
    });
    rl.once('close', () => {
      active = false;
    });
    rl.on('close', this.handleClose);
    rl.on('SIGTSTP', () => {
      if (!this.interactive) return;
      let resumed = false;
      const resume = (): void => {
        if (resumed) return;
        resumed = true;
        process.off('SIGCONT', resume);
        clearTimeout(fallback);
        if (!active) return;
        setRawMode(true);
        rl.prompt(true);
      };
      setRawMode(false);
      const fallback = setTimeout(resume, SUSPEND_FALLBACK_MS);
      process.on('SIGCONT', resume);
      process.kill(0, 'SIGTSTP');
    });
    rl.on('SIGINT', () => {
      this.muted = false;
      this.onCancel();
    });
    return rl;
  }

  private nextLine(): Promise<string | null> {
    const line = this.queue.shift();
    if (line !== undefined) return Promise.resolve(line);
    if (this.closed) return Promise.resolve(null);
    return new Promise((resolve) => this.waiting.push(resolve));
  }

  async ask(question: string, options: AskOptions = {}): Promise<string> {
    const { fallback, secret = false } = options;
    let hint = '';
    if (fallback) {
      hint = secret ? ` ${formatEnterKeep()}` : ` ${formatEnterDefault(fallback)}`;
    }
    if (this.interactive && !this.closed) {
      this.rl.setPrompt(`${question}${hint}: `);
      this.rl.prompt();
    } else if (!this.interactive) {
      // Piped answers can remain queued after EOF has closed readline.
      process.stdout.write(`${question}${hint}: `);
    }
    if (secret && this.interactive) this.muted = true;
    const line = await this.nextLine();
    if (secret && this.interactive) {
      this.queue.length = 0;
      if (!this.closed) {
        this.rl.off('close', this.handleClose);
        this.rl.close();
        this.rl = this.createReadline();
      }
    }
    if (this.muted) {
      this.muted = false;
      process.stdout.write('\n');
    } else if (!this.interactive) {
      process.stdout.write('\n');
    }
    if (line === null) throw new InputEnded();
    const value = line.trim();
    return value || fallback || '';
  }

  async askValid(
    question: string,
    check: (raw: string) => import('./validate.js').Check,
    options: AskOptions = {},
  ): Promise<string> {
    for (;;) {
      const result = check(await this.ask(question, options));
      if (result.ok) {
        if (result.warning) warn(result.warning);
        return result.value;
      }
      warn(result.error);
    }
  }

  async confirm(question: string, defaultYes: boolean): Promise<boolean> {
    for (;;) {
      const def = defaultYes ? 'Y' : 'N';
      const answer = (await this.ask(`${question} ${formatEnterDefault(def)}`)).toLowerCase();
      if (!answer) return defaultYes;
      if (['y', 'yes'].includes(answer)) return true;
      if (['n', 'no'].includes(answer)) return false;
      warn('Please answer y or n.');
    }
  }

  async choose(question: string, labels: string[], defaultIndex: number): Promise<number> {
    labels.forEach((label, i) => console.log(`  ${i + 1}) ${label}`));
    console.log('');
    return this.chooseNumber(question, labels.length, defaultIndex);
  }

  async chooseProvider(
    entries: import('./providerPick.js').ProviderMenuEntry[],
    defaultIndex: number,
    localDet: import('./providerPick.js').LocalDetection,
  ): Promise<number> {
    const { printProviderMenu } = await import('./providerPick.js');
    printProviderMenu(entries, localDet);
    return this.chooseNumber('Provider', entries.length, defaultIndex);
  }

  private async chooseNumber(question: string, count: number, defaultIndex: number): Promise<number> {
    for (;;) {
      const answer = await this.ask(question, { fallback: String(defaultIndex + 1) });
      const n = Number(answer);
      if (Number.isInteger(n) && n >= 1 && n <= count) return n - 1;
      warn(`Enter a number from 1 to ${count}.`);
    }
  }

  close(): void {
    this.rl.close();
  }
}
