/**
 * The agent's last sync when its supervisor stops it (SIGTERM: a unit's stop
 * or restart, `docker stop`). With no wake running, whatever is in the tree
 * is committed, pulled and pushed once more, so a teammate moved to another
 * machine starts from everything it did here. A wake that is running is cut
 * off as before: its own commit never happens, and what it left is
 * committed by the next start's first tick.
 */
import type { Agent } from '@macro-inc/muppet/core/agent';
import type { CommitResult } from './commit.ts';

export const stopMessage = 'sync: stopping';

/** The agent, and how many of its wakes are running now. */
export const counted = (
  agent: Agent
): { readonly agent: Agent; readonly running: () => number } => {
  let running = 0;
  return {
    agent: {
      wake: async (wake) => {
        running += 1;
        try {
          return await agent.wake(wake);
        } finally {
          running -= 1;
        }
      },
    },
    running: () => running,
  };
};

export type Stop = {
  readonly running: () => number;
  /** add, commit, pull --rebase, push (`commit`). */
  readonly commit: (message: string) => Promise<CommitResult>;
  readonly log: (entry: object) => Promise<void>;
  readonly flush: () => Promise<void>;
  readonly exit: (code: number) => void;
  /** The sync's limit: the supervisor kills the process soon after (`docker stop -t 90`). */
  readonly timeoutMs: number;
  readonly sleep: (ms: number) => Promise<void>;
};

const timedOut = 'timed out';
const stopped = 0;

/**
 * The SIGTERM handler, and a restart's: syncs once when idle, then exits with
 * `code` (0, or 75 for a restart onto code a land brought). Only the first
 * call does anything.
 */
export const stopper = (deps: Stop): ((code?: number) => Promise<void>) => {
  let stopping: Promise<void> | undefined;
  const stop = async (code: number): Promise<void> => {
    const running = deps.running();
    if (running > 0) await deps.log({ stop: 'not synced', running });
    else {
      const result = await Promise.race([
        deps
          .commit(stopMessage)
          .catch((error: unknown) => `threw: ${String(error)}`),
        deps.sleep(deps.timeoutMs).then(() => timedOut),
      ]);
      await deps.log({ stop: 'synced', result });
    }
    await deps.flush();
    deps.exit(code);
  };
  return (code = stopped) => {
    stopping ??= stop(code);
    return stopping;
  };
};

/**
 * Waits for the restart marker (MUPPET_RESTART_FILE) to change from what it
 * was when the agent started: a land in any of its processes touches it.
 * `changed` is called once, then the watch ends. The agent then stops
 * itself with 75, so no launcher needs a watch of its own.
 */
export const watchMarker = async ({
  read,
  sleep,
  everyMs,
  changed,
}: {
  /** The marker's contents; undefined while there is none. */
  readonly read: () => Promise<string | undefined>;
  readonly sleep: (ms: number) => Promise<void>;
  readonly everyMs: number;
  readonly changed: () => void;
}): Promise<void> => {
  const initial = await read();
  for (;;) {
    await sleep(everyMs);
    if ((await read()) !== initial) {
      changed();
      return;
    }
  }
};
