import { Gain, level } from './audio.ts';
import type { Emit } from './events.ts';
import type { Stt, SttEvent, SttFactory } from './stt.ts';

const _RATE = 16000;
const FRAME_MS = 20;
export type Segment = {
  start: number;
  end: number;
};
export class Segmenter {
  static readonly MIN_RMS = 40;
  static readonly HANG_MS = 500;
  static readonly MIN_VOICED_MS = 60;
  static readonly MAX_MS = 8000;
  private floor = 0;
  private start: number | null = null;
  private lastVoiced = 0;
  private voicedMs = 0;
  t = 0;
  get speaking() {
    return this.start !== null;
  }
  get voiced() {
    return this.start === null ? 0 : this.voicedMs;
  }
  push(frame: Int16Array): Segment | null {
    const { rms } = level(frame);
    const t = this.t;
    this.t += FRAME_MS;
    this.floor += (rms - this.floor) * (rms < this.floor ? 0.2 : 0.002);
    const voiced = rms >= Math.max(Segmenter.MIN_RMS, this.floor * 3);
    if (voiced) {
      if (this.start === null) {
        this.start = t;
        this.voicedMs = 0;
      }
      this.lastVoiced = t + FRAME_MS;
      this.voicedMs += FRAME_MS;
    }
    if (this.start === null) return null;
    const ended = !voiced && this.t - this.lastVoiced >= Segmenter.HANG_MS;
    if (!ended && this.t - this.start < Segmenter.MAX_MS) return null;
    const seg = { start: this.start, end: this.lastVoiced };
    const enough = this.voicedMs >= Segmenter.MIN_VOICED_MS;
    this.start = null;
    return enough ? seg : null;
  }
}
export type Rescue = (pcm: Int16Array) => Promise<string>;
const norm = (w: string) => w.toLowerCase().replace(/[^a-z0-9']/g, '');
export function trimDelivered(text: string, delivered: string): string {
  const words = text.split(/\s+/).filter(Boolean);
  const done = delivered.split(/\s+/).map(norm).filter(Boolean);
  if (!done.length) return text;
  const n = Math.min(done.length, words.length);
  let same = 0;
  for (let i = 0; i < n; i++) if (norm(words[i]!) === done[i]) same++;
  if (same < Math.max(1, n * 0.6)) return text;
  return words.slice(n).join(' ');
}
export class Ear {
  static readonly GRACE_MS = 1200;
  static readonly STABLE_MS = 600;
  static readonly PROMOTE_AFTER_MS = 1500;
  static readonly MAX_WAIT_MS = 4000;
  static readonly PAD_MS = 300;
  private gain = new Gain();
  private seg = new Segmenter();
  private ring: Int16Array[] = [];
  private stream: Stt;
  private covered = 0;
  private interim: {
    text: string;
    startMs: number;
    endMs: number;
    at: number;
  } | null = null;
  private pending: Segment[] = [];
  private dgSpeechAt: number | null = null;
  private gaveUpAt = -Infinity;
  private readonly rescues = new Set<Promise<void>>();
  private delivered: {
    text: string;
    endMs: number;
  } | null = null;
  private voiceSent = false;
  closed = false;
  static readonly VOICE_MS = 400;
  readonly who: string;
  private rescue: Rescue;
  private onEvent: (e: SttEvent) => void;
  private emit: Emit;
  constructor(
    who: string,
    stt: SttFactory,
    rescue: Rescue,
    onEvent: (e: SttEvent) => void,
    emit: Emit
  ) {
    this.who = who;
    this.rescue = rescue;
    this.onEvent = onEvent;
    this.emit = emit;
    this.stream = stt(who, (e) => this.fromStream(e));
  }
  private get now() {
    return this.seg.t;
  }
  private fromStream(ev: SttEvent) {
    let e = ev;
    if (e.kind === 'speech_started') this.dgSpeechAt = this.now;
    if (e.kind === 'final' || e.kind === 'interim') {
      const start = e.startMs ?? this.now;
      const end = e.endMs ?? this.now;
      if (e.text && end <= this.covered + 400)
        return this.emit('ear.dropped', {
          who: this.who,
          text: e.text,
          startMs: start,
          endMs: end,
        });
      if (e.text && this.delivered && start < this.delivered.endMs) {
        const rest = trimDelivered(e.text, this.delivered.text);
        if (rest !== e.text)
          this.emit('ear.trimmed', { who: this.who, text: e.text, kept: rest });
        if (!rest) return;
        e = { ...e, text: rest };
      }
      if (e.kind === 'interim')
        this.interim = {
          text: e.text,
          startMs: start,
          endMs: end,
          at: this.now,
        };
      else if (e.text) {
        this.covered = Math.max(this.covered, end);
        this.interim = null;
      } else if (e.speechFinal) {
        this.gaveUpAt = this.now;
        if (
          this.dgSpeechAt !== null &&
          !this.pending.length &&
          !this.seg.speaking &&
          this.covered < this.now - 300
        ) {
          const seg = {
            start: Math.max(this.covered, this.dgSpeechAt - 300),
            end: this.now - 200,
          };
          this.emit('ear.segment', {
            who: this.who,
            startMs: seg.start,
            endMs: seg.end,
            via: 'deepgram-vad',
          });
          this.pending.push(seg);
        }
        this.dgSpeechAt = null;
      }
    }
    this.onEvent(e);
  }
  push(raw: Int16Array) {
    const frame = this.gain.apply(raw);
    this.stream.send(frame);
    this.ring.push(frame);
    if (this.ring.length > 500) this.ring.shift();
    const s = this.seg.push(raw);
    if (!this.seg.speaking) this.voiceSent = false;
    else if (!this.voiceSent && this.seg.voiced >= Ear.VOICE_MS) {
      this.voiceSent = true;
      this.onEvent({ kind: 'voice' });
    }
    if (s) {
      this.emit('ear.segment', {
        who: this.who,
        startMs: s.start,
        endMs: s.end,
      });
      this.pending.push(s);
    }
    this.resolve();
  }
  private resolve() {
    this.pending = this.pending.filter((p) => this.covered < p.end - 200);
    if (!this.pending.length || this.seg.speaking) return;
    const first = this.pending[0]!;
    const last = this.pending.at(-1)!;
    const since = this.now - last.end;
    const gaveUp = this.gaveUpAt >= first.start;
    const words =
      !!this.interim &&
      this.interim.endMs > Math.max(this.covered, first.start - 200);
    const wait = words ? Ear.PROMOTE_AFTER_MS : Ear.GRACE_MS;
    if (since < wait && !gaveUp) return;
    const span = { start: first.start, end: last.end };
    this.pending = [];
    const rescue = this.rescueSegment(span);
    this.rescues.add(rescue);
    void rescue.finally(() => this.rescues.delete(rescue));
  }
  private deliver(text: string, until: number, via: string) {
    this.covered = Math.max(this.covered, until);
    this.interim = null;
    this.delivered = { text, endMs: until };
    this.emit('ear.final', { who: this.who, text, via });
    this.onEvent({ kind: 'final', text, speechFinal: true });
    if (!this.seg.speaking) this.onEvent({ kind: 'utterance_end' });
  }
  private async rescueSegment(s: Segment) {
    const from = Math.max(0, Math.max(s.start, this.covered) - Ear.PAD_MS);
    const to = s.end + Ear.PAD_MS;
    const firstFrameMs = this.now - this.ring.length * FRAME_MS;
    const frames = this.ring.slice(
      Math.max(0, Math.floor((from - firstFrameMs) / FRAME_MS)),
      Math.ceil((to - firstFrameMs) / FRAME_MS)
    );
    const pcm = new Int16Array(frames.length * 320);
    frames.forEach((f, i) => pcm.set(f, i * 320));
    const before = this.covered;
    const t0 = performance.now();
    const text = (
      await this.rescue(pcm).catch((e) => {
        this.emit('ear.rescue_error', { who: this.who, error: String(e) });
        return '';
      })
    ).trim();
    this.emit('ear.rescue', {
      who: this.who,
      startMs: s.start,
      endMs: s.end,
      text,
      ms: Math.round(performance.now() - t0),
    });
    if (this.closed) return;
    if (this.covered > before && this.covered >= s.end - 200) return;
    if (text) return this.deliver(text, s.end, 'rescue');
    if (this.interim && this.interim.endMs > s.start - 200) {
      const rest = this.delivered
        ? trimDelivered(this.interim.text, this.delivered.text)
        : this.interim.text;
      if (rest) return this.deliver(rest, s.end, 'interim');
    }
    this.covered = Math.max(this.covered, s.end);
    this.onEvent({ kind: 'unheard' });
  }
  async settled() {
    await Promise.all(this.rescues);
  }
  async close() {
    this.closed = true;
    await this.stream.close();
    await this.settled();
  }
}
