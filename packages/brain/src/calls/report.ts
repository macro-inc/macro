import { match } from 'ts-pattern';
import type { Event } from './events.ts';

const clock = (ms: number) =>
  `${String(Math.floor(ms / 60000)).padStart(2, '0')}:${((ms % 60000) / 1000).toFixed(1).padStart(4, '0')}`;
const short = (who: unknown) =>
  String(who ?? '')
    .replace(/^macro\|/, '')
    .replace(/@.*/, '');

function line(e: Event): string | null {
  const who = e.who ? short(e.who) : '';
  return match(e.type)
    .with('audio.level', 'stt.interim', () => null)
    .with('stt.final', () =>
      e.text ? `${who} said: ${e.text}` : `${who} (empty final)`
    )
    .with(
      'turn.ask',
      () =>
        `-> ask turn ${e.turn}: ${e.text}${e.cutOff ? ' (after cut-off)' : ''}`
    )
    .with('turn.say', () => `-> say: ${e.text}`)
    .with('brain.text', () => `agent: ${e.text}`)
    .with(
      'join.token',
      () =>
        `token attempt ${e.attempt}: ${e.error ? `FAILED after ${e.ms} ms: ${e.error}` : `ok in ${e.ms} ms`}`
    )
    .with('join.failed', () => `JOIN FAILED at ${e.stage}: ${e.error}`)
    .otherwise(() => {
      const { t: _time, type, ...rest } = e;
      return `${type} ${Object.entries(rest)
        .map(([key, value]) => `${key}=${JSON.stringify(value)}`)
        .join(' ')}`;
    });
}

export function formatReport(
  events: Event[],
  opts: { all?: boolean } = {}
): string {
  const out: string[] = [];

  const levels = new Map<string, { from: number; db: number[] }>();
  const flush = (who: string) => {
    const l = levels.get(who);
    if (l?.db.length)
      out.push(
        `${clock(l.from)}  level ${short(who)} dBFS/s: ${l.db.join(' ')}`
      );
    levels.delete(who);
  };
  for (const e of events) {
    if (e.type === 'audio.level') {
      const who = String(e.who);
      const l = levels.get(who) ?? { from: e.t, db: [] };
      l.db.push(Number(e.dbfs));
      levels.set(who, l);
      if (l.db.length >= 5) flush(who);
      continue;
    }
    if (opts.all && e.type === 'stt.interim') {
      out.push(`${clock(e.t)}  ${short(e.who)} ...${e.text}`);
      continue;
    }
    const s = line(e);
    if (s) out.push(`${clock(e.t)}  ${s}`);
  }
  for (const who of [...levels.keys()]) flush(who);

  const asks = events.filter((e) => e.type === 'turn.ask');
  const firstAudio = (turn: unknown, after: number) =>
    events.find(
      (e) => e.type === 'tts.first_audio' && e.turn === turn && e.t >= after
    );
  const lat = asks
    .map((a) => firstAudio(a.turn, a.t))
    .map((f, i) => (f ? f.t - asks[i]!.t : null));
  const answered = lat.filter((x): x is number => x !== null);
  const finals = events.filter((e) => e.type === 'stt.final' && e.text).length;
  const empty = events.filter(
    (e) => e.type === 'stt.final' && !e.text && e.speechFinal
  ).length;
  const rescues = events.filter((e) => e.type === 'ear.rescue');
  out.push('');
  out.push(
    `asks ${asks.length}, answered aloud ${answered.length}, interrupts ${events.filter((e) => e.type === 'turn.interrupt').length}`
  );
  if (answered.length) {
    const sorted = [...answered].sort((a, b) => a - b);
    out.push(
      `ask -> first audio: median ${sorted[Math.floor(sorted.length / 2)]} ms, max ${sorted.at(-1)} ms`
    );
  }
  out.push(
    `stt finals ${finals}, empty speech-finals ${empty}, rescues ${rescues.length} (found words in ${rescues.filter((r) => r.text).length})`
  );
  const joins = events.filter((e) => e.type === 'join.failed');
  if (joins.length)
    out.push(
      `JOIN FAILED ${joins.length}x: ${joins.map((j) => `${j.stage}: ${j.error}`).join('; ')}`
    );
  const errors = events.filter((e) => e.type.endsWith('error'));
  if (errors.length)
    out.push(
      `errors ${errors.length}: ${[...new Set(errors.map((e) => e.type))].join(', ')}`
    );
  return out.join('\n');
}

export async function readEvents(path: string): Promise<Event[]> {
  const text = await Deno.readTextFile(path);
  return text
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l) as Event);
}
