import { untilAborted } from '@core/util/abort-signal';
import { sleep } from '@core/util/sleep';
import type { Span } from '@macro-inc/observability';
import { PURCHASE_POLL_MS } from '../core/purchase-wait';

function settled<Progress extends string>(
  progress: Progress | 'waiting' | undefined
): progress is Exclude<Progress, 'waiting'> {
  return progress !== undefined && progress !== 'waiting';
}

/**
 * Reads `read` every `pollMs` (default `PURCHASE_POLL_MS`) until it answers something other
 * than `waiting`, `waitMs` passes (`slow`), or `stopped()`. A read
 * that fails (`undefined`) is tried again until the deadline.
 */
export async function waitForProgress<Progress extends string>(options: {
  read: () => Promise<Progress | 'waiting' | undefined>;
  waitMs: number;
  pollMs?: number;
  signal?: AbortSignal;
  span: Span;
  stopped: () => boolean;
}): Promise<Exclude<Progress, 'waiting'> | 'slow'> {
  const started = Date.now();
  let polls = 0;
  try {
    while (!options.stopped()) {
      polls += 1;
      const progress = await options.read();
      if (settled(progress)) return progress;
      if (Date.now() - started >= options.waitMs) return 'slow';
      if (options.signal?.aborted) return 'slow';
      const delay = sleep(options.pollMs ?? PURCHASE_POLL_MS);
      if (options.signal) await untilAborted(delay, options.signal);
      else await delay;
    }
    return 'slow';
  } catch (error) {
    if (options.signal?.aborted) return 'slow';
    throw error;
  } finally {
    options.span.setAttr('wait.polls', polls);
    options.span.setAttr('wait.ms', Date.now() - started);
  }
}
