import { setTimeout as delay } from 'node:timers/promises';
export type Attempt = { attempt: number; ms: number; error?: string };

export const TOKEN_RETRY = {
  attempts: 4,
  timeoutMs: 2000,
  backoffMs: [250, 750, 1500],
};

export class TimeoutError extends Error {}

export async function retry<T>(
  fn: (signal: AbortSignal) => Promise<T>,
  opts: {
    attempts: number;
    timeoutMs: number;
    backoffMs: number[];
    onAttempt?: (a: Attempt) => void;
    sleep?: (ms: number) => Promise<void>;
  }
): Promise<T> {
  const sleep = opts.sleep ?? ((ms) => delay(ms));
  let last: unknown;
  for (let attempt = 1; attempt <= opts.attempts; attempt++) {
    const ctl = new AbortController();
    const t0 = performance.now();
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const out = await Promise.race([
        fn(ctl.signal),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => {
            ctl.abort();
            reject(new TimeoutError(`timed out after ${opts.timeoutMs} ms`));
          }, opts.timeoutMs);
        }),
      ]);
      opts.onAttempt?.({ attempt, ms: Math.round(performance.now() - t0) });
      return out;
    } catch (e) {
      last = e;
      opts.onAttempt?.({
        attempt,
        ms: Math.round(performance.now() - t0),
        error: String(e instanceof Error ? e.message : e),
      });
      if (attempt < opts.attempts)
        await sleep(opts.backoffMs[attempt - 1] ?? opts.backoffMs.at(-1) ?? 0);
    } finally {
      clearTimeout(timer);
    }
  }
  throw last;
}

export function rejoinDelay(failures: number): number {
  return Math.min(1000 * 2 ** Math.max(0, failures - 1), 8000);
}
