import type { StatePaths } from '@macro-inc/muppet/core/state';

/**
 * Where the agent records anything. Everything is under one state directory, in
 * one of four buckets, and the bucket is the rule for whether git keeps it:
 * a path says whether it survives, so nothing new is committed by accident.
 *
 * - memory: committed. What the agent knows, and its own durable records.
 * - private: never committed. People, their messages, mail, screenshots.
 * - run: never committed, volatile. Queues, cursors, locks, per-run records.
 * - log: never committed. Logs and recordings, pruned.
 *
 * Each capability or area has its own directory in each bucket, which only
 * it writes. `capability` is its memory directory, and `shared` is the
 * memory any of them may use: notes, asks, and the like.
 */
export type State = StatePaths & {
  readonly memory: (owner: string) => string;
  readonly private: (owner: string) => string;
  readonly run: (owner: string) => string;
  readonly log: (owner: string) => string;
  /** A file in the shared memory, e.g. `notes.md`. */
  readonly sharedFile: (name: string) => string;
};

export const buckets = {
  memory: { committed: true },
  private: { committed: false },
  run: { committed: false },
  log: { committed: false },
} as const;

export type Bucket = keyof typeof buckets;

const stateDirectory = 'state';
const sharedDirectory = 'shared';

export const state = ({
  root,
  join,
}: {
  readonly root: string;
  readonly join: (...parts: readonly string[]) => string;
}): State => {
  const bucket = (name: Bucket) => (owner: string) =>
    join(root, stateDirectory, name, owner);
  const memory = bucket('memory');
  return {
    shared: memory(sharedDirectory),
    sharedFile: (name) => join(memory(sharedDirectory), name),
    capability: memory,
    memory,
    private: bucket('private'),
    run: bucket('run'),
    log: bucket('log'),
  };
};
