import { match } from 'ts-pattern';
import { askContent, type Brain, SILENT } from './brain.ts';
import type { Emit } from './events.ts';
import type { SttEvent } from './stt.ts';
import { speakable, type Tts } from './tts.ts';
import { type Action, type TurnEvent, Turns } from './turns.ts';
export interface Speaker {
  play(pcm: Int16Array): void;
  clear(): void;
  duck(on: boolean): void;
  drained(): Promise<void>;
}
export type TtsFactory = (h: {
  onAudio: (pcm: Int16Array, turn: number) => void;
  onDone: (turn: number) => void;
}) => Tts;
export class Call {
  readonly turns: Turns;
  private tts: Tts;
  private current = 0;
  private playing = false;
  private stopped = false;
  private sayTurn = -1;
  private ended = new Set<number>();
  private flushed = new Set<number>();
  private timer: ReturnType<typeof setInterval> | null = null;
  onLeave: (why: string) => void = () => {};
  private brain: Brain;
  private speaker: Speaker;
  private emit: Emit;
  private now: () => number;
  constructor(
    brain: Brain,
    tts: TtsFactory,
    speaker: Speaker,
    emit: Emit,
    now: () => number,
    policy: {
      names: string[];
      answer?: (who: string, text: string) => boolean;
    }
  ) {
    this.brain = brain;
    this.speaker = speaker;
    this.emit = emit;
    this.now = now;
    this.turns = new Turns(policy.names, policy.answer);
    this.tts = tts({
      onAudio: (pcm, turn) => {
        if (turn !== this.current) return;
        if (!this.playing) {
          this.playing = true;
          this.feed({ type: 'agent_audio', playing: true });
        }
        this.speaker.play(pcm);
      },
      onDone: (turn) => {
        this.flushed.add(turn);
        void this.maybeFinish(turn);
      },
    });
  }
  start(tickMs = 50) {
    this.timer = setInterval(
      () => this.run(this.turns.tick(this.now())),
      tickMs
    );
  }
  async stop() {
    this.stopped = true;
    if (this.timer) clearInterval(this.timer);
    this.current = 0;
    this.brain.interrupt();
    this.speaker.clear();
    await this.tts.close();
  }
  joined(who: string, name: string) {
    this.feed({ type: 'joined', who, name });
  }
  left(who: string) {
    this.feed({ type: 'left', who });
  }
  heard(who: string, ev: SttEvent) {
    this.feed({ type: 'stt', who, ev });
  }
  say(text: string) {
    this.run([{ type: 'say', text }]);
  }
  private feed(e: TurnEvent) {
    if (this.stopped) return;
    this.run(this.turns.handle(e, this.now()));
  }
  private run(actions: Action[]) {
    if (this.stopped) return;
    for (const a of actions) {
      const { type, ...rest } = a;
      this.emit(`turn.${type}`, rest);
      match(a)
        .with({ type: 'ask' }, (a) => {
          this.current = a.turn;
          void this.answer(a.turn, askContent(a));
          return;
        })
        .with({ type: 'say' }, (a) => {
          const t = this.sayTurn--;
          if (this.current > 0 && !this.ended.has(this.current)) return;
          this.current = t;
          this.ended.add(t);
          this.tts.speak(a.text, t);
          this.tts.flush(t);
          return;
        })
        .with({ type: 'stop_speaking' }, (_a) => {
          this.silence();
          return;
        })
        .with({ type: 'duck' }, (a) => {
          this.speaker.duck(a.on);
          return;
        })
        .with({ type: 'interrupt' }, (_a) => {
          this.brain.interrupt();
          this.silence();
          return;
        })
        .with({ type: 'leave' }, (a) => {
          this.onLeave(a.why);
          return;
        })
        .exhaustive();
    }
  }
  private silence() {
    this.tts.clear();
    this.speaker.clear();
    this.current = 0;
    if (this.playing) {
      this.playing = false;
      this.emit('agent.audio_stopped');
    }
  }
  private async answer(turn: number, content: string) {
    try {
      for await (const s of this.brain.ask(turn, content)) {
        if (turn !== this.current) break;
        if (s.trim() === SILENT) continue;
        const text = speakable(s);
        if (!text) continue;
        this.emit('brain.text', { turn, text });
        this.tts.speak(text, turn);
      }
    } catch (e) {
      this.emit('brain.error', { turn, error: String(e) });
    }
    this.ended.add(turn);
    if (turn === this.current) this.tts.flush(turn);
    else this.feed({ type: 'brain_done', turn });
  }
  private async maybeFinish(turn: number) {
    if (
      turn !== this.current ||
      !this.ended.has(turn) ||
      !this.flushed.has(turn)
    )
      return;
    await this.speaker.drained();
    if (turn !== this.current) return;
    this.current = 0;
    if (this.playing) {
      this.playing = false;
      this.feed({ type: 'agent_audio', playing: false });
    }
    if (turn > 0) this.feed({ type: 'brain_done', turn });
    this.emit('turn.completed', { turn });
  }
}
