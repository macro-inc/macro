/**
 * Where the agent records things, and the check that git keeps only what it
 * should. The bucket is the rule, not a list of files to keep out: with a
 * denylist, anything new would default to committed and pushed, people's
 * data included.
 */
import { type Bucket, buckets } from '../../context/state.ts';

export const bucketNames: readonly Bucket[] = [
  'memory',
  'private',
  'run',
  'log',
];

/** What each bucket is for, for whoever asks where something goes. */
export const what: Readonly<Record<Bucket, string>> = {
  memory: 'What the agent knows, and its own durable records.',
  private:
    'People, their messages, mail, screenshots, profiles. Stays on this machine.',
  run: 'Volatile: locks, cursors, flags, per-run records. Safe to delete when nothing is running.',
  log: 'Logs and recordings. Pruned by the prune capability.',
};

const isBucket = (name: string): name is Bucket => name in buckets;

export type Misplaced = {
  /** Tracked by git, in a bucket that is never committed. */
  readonly local: readonly string[];
  /** Tracked by git, under the state directory, in no bucket at all. */
  readonly stray: readonly string[];
};

/** Which tracked files, as paths inside the state directory, git should not be keeping. */
export const misplaced = (tracked: readonly string[]): Misplaced => {
  const bucketOf = (path: string): string => path.split('/')[0] ?? '';
  return {
    local: tracked.filter((path) => {
      const bucket = bucketOf(path);
      return isBucket(bucket) && !buckets[bucket].committed;
    }),
    stray: tracked.filter((path) => !isBucket(bucketOf(path))),
  };
};
