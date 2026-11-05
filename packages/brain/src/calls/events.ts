import { closeSync, mkdirSync, openSync, writeSync } from 'node:fs';
import { startSpan } from '../telemetry.ts';
import { level, wavHeader } from './audio.ts';

export type Event = { t: number; type: string; [k: string]: unknown };
export type Emit = (type: string, data?: Record<string, unknown>) => void;

export class EventLog {
  readonly t0 = performance.now();
  private fd: number | null;
  constructor(
    readonly dir: string | null,
    private echo = false
  ) {
    if (dir) mkdirSync(dir, { recursive: true, mode: 0o700 });
    this.fd = dir ? openSync(`${dir}/events.jsonl`, 'a', 0o600) : null;
  }
  now = () => Math.round(performance.now() - this.t0);
  emit: Emit = (type, data = {}) => {
    const line = JSON.stringify({ t: this.now(), type, ...data });
    if (this.fd !== null) writeSync(this.fd, line + '\n');
    if (this.echo) console.log(line);
    if (
      [
        'room.first_frame',
        'stt.final',
        'ear.rescue',
        'turn.ask',
        'turn.duck',
        'turn.interrupt',
        'tts.first_audio',
        'call.leave',
      ].includes(type)
    ) {
      const span = startSpan(`brain.call.${type}`, {
        ...(typeof data.turn === 'number' ? { 'call.turn': data.turn } : {}),
        ...(typeof data.ms === 'number' ? { 'call.elapsed_ms': data.ms } : {}),
        'call.has_text': typeof data.text === 'string' && data.text.length > 0,
      });
      span.end();
    }
  };
  close() {
    if (this.fd !== null) closeSync(this.fd);
    this.fd = null;
  }
}

export class TrackRecorder {
  private fd: number;
  private written = 0;
  private levelAcc: Int16Array[] = [];
  private levelSince: number;
  constructor(
    path: string,
    readonly rate: number,
    private log: EventLog,
    readonly who: string
  ) {
    this.fd = openSync(path, 'w', 0o600);
    writeSync(this.fd, wavHeader(rate, 0));

    this.fill(Math.floor((log.now() / 1000) * rate));
    this.levelSince = log.now();
  }
  private fill(n: number) {
    const chunk = new Uint8Array(Math.min(n, this.rate) * 2);
    for (let left = n; left > 0; left -= chunk.length / 2)
      writeSync(
        this.fd,
        chunk.subarray(0, Math.min(left, chunk.length / 2) * 2)
      );
    this.written += n;
  }
  write(frame: Int16Array) {
    const due = Math.floor((this.log.now() / 1000) * this.rate) - frame.length;
    const gap = due - this.written;
    if (gap > this.rate / 5) {
      this.log.emit('audio.gap', {
        who: this.who,
        ms: Math.round((gap / this.rate) * 1000),
      });
      this.fill(gap);
    }
    writeSync(
      this.fd,
      new Uint8Array(frame.buffer, frame.byteOffset, frame.byteLength)
    );
    this.written += frame.length;
    this.levelAcc.push(frame);
    if (this.log.now() - this.levelSince >= 1000) this.flushLevel();
  }
  private flushLevel() {
    if (!this.levelAcc.length) return;
    const all = new Int16Array(this.levelAcc.reduce((n, f) => n + f.length, 0));
    let o = 0;
    for (const f of this.levelAcc) {
      all.set(f, o);
      o += f.length;
    }
    this.log.emit('audio.level', {
      who: this.who,
      frames: this.levelAcc.length,
      ...level(all),
    });
    this.levelAcc = [];
    this.levelSince = this.log.now();
  }
  close() {
    this.flushLevel();
    writeSync(this.fd, wavHeader(this.rate, this.written * 2), 0, 44, 0);
    closeSync(this.fd);
  }
}
