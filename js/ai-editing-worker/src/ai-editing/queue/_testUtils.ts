import type { DocWriter } from '../doc/interfaces';
import type { Awareness } from './types';

/** Records every DocWriter call; can be told to throw on a given fn (or several). */
export function recordingWriter(
  throwOn?: { fn: string; error: string } | Array<{ fn: string; error: string }>
) {
  const throwers = throwOn
    ? Array.isArray(throwOn)
      ? throwOn
      : [throwOn]
    : [];
  const calls: Array<{ fn: string; args: unknown[] }> = [];
  const w = new Proxy(
    {},
    {
      get:
        (_t, fn: string) =>
        (...args: unknown[]) => {
          const t = throwers.find((x) => x.fn === fn);
          if (t) throw new Error(t.error);
          calls.push({ fn, args });
        },
    }
  ) as DocWriter;
  return { w, calls };
}

export function recordingAwareness() {
  const seen: Awareness[] = [];
  return { source: { apply: (x: Awareness) => void seen.push(x) }, seen };
}
