import { match } from 'ts-pattern';
import type { SttEvent } from './stt.ts';

export type TurnEvent =
  | { type: 'joined'; who: string; name: string }
  | { type: 'left'; who: string }
  | { type: 'stt'; who: string; ev: SttEvent }
  | { type: 'agent_audio'; playing: boolean }
  | { type: 'brain_done'; turn: number };

export type Action =
  | {
      type: 'ask';
      turn: number;
      who: string;
      name: string;
      text: string;
      context: string[];
      cutOff: boolean;
    }
  | { type: 'say'; text: string }
  | { type: 'stop_speaking' }
  | { type: 'duck'; on: boolean }
  | { type: 'interrupt'; turn: number }
  | { type: 'leave'; why: string };

export const SETTLE_MS = 300;
export const NAME_ONLY_MS = 2500;
export const MAX_HOLD_MS = 4000;
export const FOLLOW_UP_MS = 20_000;
export const BARGE_IN_WORDS = 2;
export const UNHEARD_EVERY_MS = 8000;

export const DUCK_MS = 2000;
export const UNHEARD_QUIET_MS = 3000;
export const ALONE_MS = 30_000;
export const NOBODY_MS = 60_000;
export const UNHEARD_LINE = "Sorry, didn't catch that.";

const STOP = /^\W*(stop|wait|hold on|hang on|sorry|no|nope|okay stop)\b/i;

type Speaker = {
  name: string;
  buf: string[];
  speaking: boolean;
  lastWords: number;
  due: number | null;
};

export class Turns {
  private readonly name: RegExp;
  private readonly nameOnly: RegExp;

  constructor(
    names: string[],
    private readonly answer?: (who: string, text: string) => boolean
  ) {
    const escaped = names
      .map((name) => name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
      .join('|');
    this.name = new RegExp(`\\b(${escaped})\\b`, 'i');
    this.nameOnly = new RegExp(
      `^\\W*((hey|yo|ok|okay|so|hi)\\W+)?(${escaped})\\W*$`,
      'i'
    );
  }

  state: 'idle' | 'thinking' | 'speaking' = 'idle';
  turn = 0;
  private humans = new Map<string, Speaker>();
  private heard: string[] = [];
  private audioPlaying = false;
  private asker: { who: string; text: string; spoke: boolean } | null = null;
  private cutOff = false;
  private unanswered: { who: string; text: string } | null = null;
  private followUp: { who: string; until: number } | null = null;
  private lastUnheard = -Infinity;
  private ducked: { until: number } | null = null;
  private lastAgentAudio = -Infinity;
  private aloneSince: number | null = 0;
  private everJoined = false;

  handle(e: TurnEvent, now: number): Action[] {
    return match(e)
      .returnType<Action[]>()
      .with({ type: 'joined' }, (e) => {
        this.humans.set(
          e.who,
          this.humans.get(e.who) ?? {
            name: e.name,
            buf: [],
            speaking: false,
            lastWords: now,
            due: null,
          }
        );
        this.aloneSince = null;
        this.everJoined = true;
        return [];
      })
      .with({ type: 'left' }, (e) => {
        this.humans.delete(e.who);
        if (!this.humans.size) this.aloneSince = now;
        return [];
      })
      .with({ type: 'agent_audio' }, (e) => {
        this.audioPlaying = e.playing;
        this.lastAgentAudio = now;
        if (!e.playing) this.ducked = null;
        if (e.playing && this.state === 'thinking') {
          this.state = 'speaking';
          if (this.asker) this.asker.spoke = true;
        }
        return [];
      })
      .with({ type: 'brain_done' }, (e) => {
        if (e.turn !== this.turn || this.state === 'idle') return [];
        this.state = 'idle';
        if (this.asker)
          this.followUp = { who: this.asker.who, until: now + FOLLOW_UP_MS };
        this.asker = null;
        return [];
      })
      .with({ type: 'stt' }, (e) => {
        return this.stt(e.who, e.ev, now);
      })
      .exhaustive();
  }

  private stt(who: string, ev: SttEvent, now: number): Action[] {
    const s = this.humans.get(who);
    if (!s) return [];
    const out: Action[] = [];
    match(ev)
      .with({ kind: 'speech_started' }, (_ev) => {
        s.speaking = true;
        return;
      })
      .with({ kind: 'interim' }, (ev) => {
        s.lastWords = now;
        if (s.due !== null) s.due = now + SETTLE_MS;
        out.push(...this.bargeIn(who, ev.text, now));
        return;
      })
      .with({ kind: 'final' }, (ev) => {
        s.lastWords = now;
        if (ev.text) {
          s.buf.push(ev.text);
          const cut = this.bargeIn(who, ev.text, now);
          out.push(...cut);

          if (!cut.length && this.ducked) out.push(...this.unduck());
        }
        if (ev.speechFinal) s.speaking = false;
        if (s.buf.length)
          s.due =
            now +
            (this.nameOnly.test(s.buf.join(' '))
              ? NAME_ONLY_MS
              : s.speaking
                ? MAX_HOLD_MS
                : SETTLE_MS);
        return;
      })
      .with({ kind: 'utterance_end' }, (_ev) => {
        s.speaking = false;
        if (s.buf.length) s.due = now;
        out.push(...this.tick(now));
        return;
      })
      .with({ kind: 'voice' }, (_ev) => {
        out.push(...this.bargeIn(who, '', now, true));
        return;
      })
      .with({ kind: 'unheard' }, (_ev) => {
        if (this.ducked) {
          out.push(...this.unduck());
          return;
        }
        if (
          this.oneOnOne() &&
          this.state === 'idle' &&
          !this.audioPlaying &&
          now - this.lastAgentAudio >= UNHEARD_QUIET_MS &&
          now - this.lastUnheard >= UNHEARD_EVERY_MS
        ) {
          this.lastUnheard = now;
          out.push({ type: 'say', text: UNHEARD_LINE });
        }
        return;
      })
      .exhaustive();
    return out;
  }

  private unduck(): Action[] {
    this.ducked = null;
    return [{ type: 'duck', on: false }];
  }

  private bargeIn(
    who: string,
    text: string,
    now: number,
    voice = false
  ): Action[] {
    if (this.state === 'idle' && !this.audioPlaying) return [];
    if (voice) {
      const theirs = this.oneOnOne() || who === this.asker?.who;
      if (!theirs) return [];
      if (
        !this.audioPlaying &&
        !(this.state === 'thinking' && who === this.asker?.who)
      )
        return [];
      if (this.audioPlaying) {
        if (this.ducked) return [];
        this.ducked = { until: now + DUCK_MS };
        return [{ type: 'duck', on: true }];
      }
    } else {
      const words = text.split(/\s+/).filter(Boolean).length;
      if (words < BARGE_IN_WORDS && !this.name.test(text) && !STOP.test(text))
        return [];
    }

    if (
      this.state === 'thinking' &&
      !this.oneOnOne() &&
      who !== this.asker?.who &&
      !this.name.test(text)
    )
      return [];
    const out: Action[] = [];
    if (this.audioPlaying) {
      out.push({ type: 'stop_speaking' });
      this.audioPlaying = false;
      this.lastAgentAudio = now;
      this.ducked = null;
    }
    if (this.state !== 'idle') {
      out.push({ type: 'interrupt', turn: this.turn });
      if (this.asker?.spoke) this.cutOff = true;
      else if (this.asker)
        this.unanswered = { who: this.asker.who, text: this.asker.text };

      this.followUp = { who, until: Infinity };
      this.state = 'idle';
      this.asker = null;
    }
    return out;
  }

  private oneOnOne() {
    return this.humans.size === 1;
  }

  private addressed(who: string, text: string, now: number) {
    if (this.answer) return this.answer(who, text);
    if (this.oneOnOne() || this.name.test(text)) return true;
    return this.followUp?.who === who && now <= this.followUp.until;
  }

  tick(now: number): Action[] {
    const out: Action[] = [];
    if (this.ducked && now >= this.ducked.until) out.push(...this.unduck());
    if (this.aloneSince !== null) {
      const limit = this.everJoined ? ALONE_MS : NOBODY_MS;
      if (now - this.aloneSince >= limit) {
        this.aloneSince = null;
        out.push({
          type: 'leave',
          why: this.everJoined ? 'everyone left' : 'nobody joined',
        });
      }
    }
    for (const [who, s] of this.humans) {
      const hold = s.speaking && now - s.lastWords < MAX_HOLD_MS;
      if (s.due === null || now < s.due || hold) continue;
      let text = s.buf.join(' ');
      s.buf = [];
      s.due = null;
      const line = `${s.name}: ${text}`;

      const backchannel =
        this.state !== 'idle' &&
        text.split(/\s+/).filter(Boolean).length < BARGE_IN_WORDS &&
        !this.name.test(text);
      if (backchannel || !this.addressed(who, text, now)) {
        this.heard = [...this.heard.slice(-80), line];
        continue;
      }
      if (this.unanswered?.who === who)
        text = `${this.unanswered.text} ${text}`;
      this.unanswered = null;
      if (this.state !== 'idle')
        out.push({ type: 'interrupt', turn: this.turn });
      this.turn++;
      out.push({
        type: 'ask',
        turn: this.turn,
        who,
        name: s.name,
        text,
        context: this.heard,
        cutOff: this.cutOff,
      });
      this.heard = [];
      this.cutOff = false;
      this.state = 'thinking';
      this.asker = { who, text, spoke: false };
      this.followUp = null;
    }
    return out;
  }
}
