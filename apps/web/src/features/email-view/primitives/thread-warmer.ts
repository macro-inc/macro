import { Telemetry } from '@macro-inc/observability';
import { AsyncQueuer } from '@tanstack/pacer';

/** A warmed thread stays warm about as long as the thread cache keeps it fresh. */
const WARM_TTL_MS = 5 * 60 * 1000;

export type ThreadWarmer = {
  /** Warm these threads next. Requests nobody is near any more are dropped. */
  warm: (threadIds: readonly string[]) => void;
  dispose: () => void;
};

/**
 * Loads threads the user is about to open (the row under the cursor, the open
 * thread's neighbours) two at a time, each at most once per TTL. A warm that
 * failed or left the thread uncached is forgotten so a later request retries
 * it. Each warm is an `email.thread.warm` span with its queue wait and outcome.
 */
export function createThreadWarmer(options: {
  /** Resolves to whether the thread's first page is now cached. */
  warm: (threadId: string) => Promise<boolean>;
  now?: () => number;
}): ThreadWarmer {
  const now = options.now ?? Date.now;
  const startedAt = new Map<string, number>();
  const isWarm = (threadId: string) => {
    const at = startedAt.get(threadId);
    return at !== undefined && now() - at < WARM_TTL_MS;
  };
  const queuer = new AsyncQueuer<{ threadId: string; queuedAt: number }>(
    async ({ threadId, queuedAt }) => {
      if (isWarm(threadId)) return;
      startedAt.set(threadId, now());
      await Telemetry.span('email.thread.warm', async (span) => {
        span.setAttr('email.thread_id', threadId);
        span.setAttr('email.warm.queued_ms', now() - queuedAt);
        try {
          const cached = await options.warm(threadId);
          span.setAttr('email.warm.cached', cached);
          if (!cached) startedAt.delete(threadId);
        } catch (error) {
          // A background warm has no caller to report to; its span does.
          startedAt.delete(threadId);
          span.error(error);
        }
      });
    },
    { concurrency: 2, started: true }
  );
  return {
    warm(threadIds) {
      queuer.clear();
      for (const threadId of threadIds) {
        if (!isWarm(threadId)) queuer.addItem({ threadId, queuedAt: now() });
      }
    },
    dispose() {
      queuer.stop();
      queuer.clear();
    },
  };
}
