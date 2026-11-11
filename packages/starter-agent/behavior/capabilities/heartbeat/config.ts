/**
 * The heartbeat's own settings: every name, place and limit it uses, so
 * nothing else in the area holds a path or an id of its own.
 */
import type { State } from '../../context/state.ts';

/** The owner of the heartbeat's state directories. */
export const owner = 'heartbeat';

/** The streams the heartbeat logs to, read back with `clockReport`. */
export const logs = { heartbeat: 'heartbeat', schedules: 'schedules' } as const;

export const settings = {
  /** Where the agent's own repository is pulled from and pushed to, and the only branch that is. */
  remote: 'origin',
  main: 'main',
  /** With GitHub, the CI job that must have passed on a commit for it to land. */
  checkJob: 'check',
  /** The script that must pass on a commit for it to land. */
  checkScript: 'check',
  /** Where checks and rebases get their worktrees, inside the repository so they resolve its packages. */
  worktrees: '.worktrees',
  /** The programs the heartbeat runs. */
  git: 'git',
  gh: 'gh',
  bun: 'bun',
  /** Files whose change means dependencies must be installed after a landing. */
  manifests: ['package.json', 'bun.lock'],
} as const;

/** How long things may take, in milliseconds. */
export const limits = {
  /** A commit waits this long for the git lock, then leaves its change for the next commit. */
  commitLockWait: 60_000,
  landLockWait: 30 * 60_000,
  ciTimeout: 15 * 60_000,
  ciPoll: 10_000,
  mergedTimeout: 30_000,
  mergedPoll: 3_000,
  gh: 30_000,
  install: 5 * 60_000,
  lockPoll: 100,
} as const;

const cursorFile = 'tick.json';
const snapshotFile = 'snapshot.md';
const gitLockFile = 'git.lock';
const conflictFile = 'conflict';
const mergesFile = 'merges.md';
const notesFile = 'notes.md';

/** Every file the heartbeat reads or writes, or names in a prompt. */
export const paths = ({
  state,
  join,
}: {
  readonly state: State;
  readonly join: (...parts: readonly string[]) => string;
}) => ({
  /** The last tick that woke the agent: the snapshot's hash, and when it ran. */
  cursor: join(state.run(owner), cursorFile),
  /** The snapshot of the last tick that woke the agent, to diff the next against. */
  snapshot: join(state.run(owner), snapshotFile),
  /** Held by anything that commits, lands or compares with the remote. */
  gitLock: join(state.run(owner), gitLockFile),
  /** Holds the remote SHA a pull conflicted on, once the owner was told. */
  conflict: join(state.run(owner), conflictFile),
  /** The merge log: one row per merged PR or landing. */
  merges: join(state.memory(owner), mergesFile),
  /** The agent's notes from one wake to the next. */
  notes: state.sharedFile(notesFile),
});

export type Paths = ReturnType<typeof paths>;
