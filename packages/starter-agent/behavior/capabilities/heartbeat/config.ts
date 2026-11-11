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
  /** Where the agent's own repository is pushed, and the only branch that is. */
  remote: 'origin',
  main: 'main',
  /** The CI job that must have passed on a commit for it to land. */
  checkJob: 'check',
  /** The script that stands in for CI while the repository has no remote. */
  checkScript: 'check',
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
  /** The tick's tamper check skips a tick rather than wait behind a commit or a landing. */
  guardLockWait: 5_000,
  landLockWait: 30 * 60_000,
  ciTimeout: 15 * 60_000,
  ciPoll: 10_000,
  mergedTimeout: 30_000,
  mergedPoll: 3_000,
  gh: 30_000,
  install: 5 * 60_000,
  /** GitHub's commit list can lag a push: a SHA behind what was pushed is read again this many times, this far apart. */
  staleReads: 6,
  reread: 5_000,
  lockPoll: 100,
} as const;

const cursorFile = 'tick.json';
const snapshotFile = 'snapshot.md';
const gitLockFile = 'git.lock';
const mainAlarmFile = 'main-alarm';
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
  /** Holds the remote SHA already alarmed on. While it exists, commits stay local. */
  mainAlarm: join(state.run(owner), mainAlarmFile),
  /** The merge log: one row per merged PR or landing. */
  merges: join(state.memory(owner), mergesFile),
  /** The agent's notes from one wake to the next. */
  notes: state.sharedFile(notesFile),
});

export type Paths = ReturnType<typeof paths>;
