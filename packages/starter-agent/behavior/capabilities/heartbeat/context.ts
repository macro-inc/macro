/**
 * What the heartbeat adds to the agent's context: its paths, and the few
 * things it needs from the machine that the base context doesn't have (a
 * lock other processes respect, a directory listing that says what is a
 * directory, a hash, a scratch directory).
 */

import { dlopen, FFIType } from 'bun:ffi';
import { closeSync, mkdirSync, openSync } from 'node:fs';
import { mkdir, mkdtemp, readdir, rm, stat } from 'node:fs/promises';
import { dirname, join as joinPath } from 'node:path';
import { behavior, type ContextOf } from '@macro-inc/muppet/core/behavior';
import type { Base } from '../../context/index.ts';
import type { Bucket } from '../../context/state.ts';
import { limits, owner, paths, settings } from './config.ts';
import type { Entry, Rule, Tree } from './prune.ts';
import type { Held } from './repository.ts';

/** What other areas hand the heartbeat when the behavior is composed. */
export type Extras = {
  /**
   * What the tick watches. Each returns a section of the snapshot (a
   * `## Heading` and lines, with nothing in it that changes on its own), or
   * empty when there is nothing to say. A change in one wakes the agent.
   */
  readonly sections?: readonly (() => Promise<string>)[];
  /** What else to prune: an area with per-run files or histories of its own adds a rule for them. */
  readonly prune?: readonly Rule[];
  /**
   * Restarts the agent onto code that landed (`restarter` in `restart.ts`).
   * Only a supervised agent has one; without it, landed code takes effect
   * when the agent is next started.
   */
  readonly restart?: () => Promise<void>;
};

/** A lock that other processes respect, and that the system drops if its holder dies. */
export type Lock = (file: string, waitMs: number) => Promise<Held | undefined>;

const exclusive = 2;
const nonBlocking = 4;
const libc = 'libc.so.6';
const scratchPrefix = 'agent-heartbeat-';

/**
 * flock(2): commits come from the running agent, from `bin/agent commit`,
 * and from a Claude Code hook, so the lock has to hold across processes, and
 * a holder that crashes must not leave it taken.
 */
const flockLock = (sleep: (milliseconds: number) => Promise<void>): Lock => {
  let flock: ((descriptor: number, operation: number) => number) | undefined;
  return async (file, waitMs) => {
    flock ??= dlopen(libc, {
      flock: { args: [FFIType.i32, FFIType.i32], returns: FFIType.i32 },
    }).symbols.flock;
    mkdirSync(dirname(file), { recursive: true });
    const descriptor = openSync(file, 'w');
    for (let waited = 0; flock(descriptor, exclusive | nonBlocking) !== 0; ) {
      if (waited >= waitMs) {
        closeSync(descriptor);
        return undefined;
      }
      await sleep(limits.lockPoll);
      waited += limits.lockPoll;
    }
    let held = true;
    return {
      release: () => {
        if (held) closeSync(descriptor);
        held = false;
      },
    };
  };
};

const tree: Tree = {
  entries: async (directory) => {
    const names = await readdir(directory).catch((): string[] => []);
    const entries = await Promise.all(
      names.sort().map(async (name): Promise<readonly Entry[]> => {
        const stats = await stat(joinPath(directory, name)).catch(
          () => undefined
        );
        return stats === undefined
          ? []
          : [
              {
                name,
                directory: stats.isDirectory(),
                modified: Temporal.Instant.fromEpochMilliseconds(
                  Math.round(stats.mtimeMs)
                ),
              },
            ];
      })
    );
    return entries.flat();
  },
};

export const heartbeatContext = (base: Base, extras: Extras = {}) => {
  const { state, clock, join, config } = base;
  const worktrees = join(config.root, settings.worktrees);
  const memory = dirname(state.memory(owner));
  const buckets: Readonly<Record<Bucket, string>> = {
    memory,
    private: dirname(state.private(owner)),
    run: dirname(state.run(owner)),
    log: dirname(state.log(owner)),
  };
  return behavior<Base>().decorate({
    heartbeat: {
      paths: paths({ state, join }),
      /** The state directory and its buckets. */
      stateRoot: dirname(memory),
      buckets,
      lock: flockLock(clock.sleep),
      tree,
      /** sha256 of a text, as hex. */
      digest: (text: string): string =>
        new Bun.CryptoHasher('sha256').update(text).digest('hex'),
      /** A fresh empty directory under `.worktrees/`, for a worktree to check or rebase in. */
      scratch: {
        make: async () => {
          await mkdir(worktrees, { recursive: true });
          return mkdtemp(joinPath(worktrees, scratchPrefix));
        },
        remove: (path: string) => rm(path, { recursive: true, force: true }),
      },
      sections: extras.sections ?? [],
      prune: extras.prune ?? [],
      restart: extras.restart,
      /** Why the tick that is running now woke the agent. Undefined between ticks. */
      awake: new Map<'reason', string>(),
    },
  });
};

export type HeartbeatContext = ContextOf<ReturnType<typeof heartbeatContext>>;
