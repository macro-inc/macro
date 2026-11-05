import { readFile } from 'node:fs/promises';
import { frames, parseWav, resample } from './audio.ts';
import { Ear, type Rescue } from './ear.ts';
import type { Emit } from './events.ts';
import type { SttFactory } from './stt.ts';
import { type Action, Turns } from './turns.ts';
export type ReplayResult = {
  actions: {
    t: number;
    action: Action;
  }[];
  asks: string[];
};
/** Replay the same ear and turn machine without wall-clock polling or a model. */
export async function replayPcm(
  samples: Int16Array,
  rate: number,
  opts: {
    stt: SttFactory;
    rescue: Rescue;
    emit: Emit;
    tailMs?: number;
  }
): Promise<ReplayResult> {
  const pcm = resample(samples, rate, 16000);
  const turns = new Turns(['Agent']);
  const actions: ReplayResult['actions'] = [];
  let now = 0;
  const act = (next: Action[]) => {
    for (const action of next) {
      actions.push({ t: now, action });
      const { type, ...rest } = action;
      opts.emit(`turn.${type}`, rest);
      if (action.type === 'ask')
        act(turns.handle({ type: 'brain_done', turn: action.turn }, now));
    }
  };
  turns.handle({ type: 'joined', who: 'replay', name: 'Caller' }, 0);
  const ear = new Ear(
    'replay',
    opts.stt,
    opts.rescue,
    (ev) => act(turns.handle({ type: 'stt', who: 'replay', ev }, now)),
    opts.emit
  );
  const all = new Int16Array(pcm.length + (opts.tailMs ?? 3000) * 16);
  all.set(pcm);
  for (const frame of frames(all, 320)) {
    ear.push(frame);
    now += 20;
    await ear.settled();
    act(turns.tick(now));
  }
  await ear.close();
  act(turns.tick(now + 4000));
  return {
    actions,
    asks: actions.flatMap(({ action }) =>
      action.type === 'ask'
        ? [action.text]
        : action.type === 'say'
          ? [`(say) ${action.text}`]
          : []
    ),
  };
}
export async function replayWav(
  path: string,
  opts: Parameters<typeof replayPcm>[2]
) {
  const wav = parseWav(await readFile(path));
  return replayPcm(wav.samples, wav.rate, opts);
}
