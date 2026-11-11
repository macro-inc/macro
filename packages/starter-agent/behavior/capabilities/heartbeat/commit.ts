/**
 * Commits whatever the agent changed (notes, prompts, its charter, its code)
 * so its memory and self-edits have history, then pushes if there is a
 * remote. Code only flows out: nothing is ever pulled. A rejected push means
 * someone else pushed: no merge, no retrying against it, one alarm, and
 * commits stay local until the remote is back at what was last pushed.
 */
import { checkMain } from './guard.ts';
import { pushedRef, type Repository } from './repository.ts';

export type CommitResult =
  /** Nothing to commit and nothing to push. */
  | 'clean'
  /** Committed, and not pushed: there is no remote, or the checkout isn't on main. */
  | 'committed'
  | 'pushed'
  /** Not committed, e.g. no identity. The change stays staged for the next commit. */
  | 'commit-failed'
  /** The push failed for a reason that isn't someone else's push, e.g. the network. The next commit retries. */
  | 'push-failed'
  /** Someone else pushed. Commits stay local until that is settled. */
  | 'push-blocked'
  /** The git lock stayed busy. The change stays in the tree for the next commit. */
  | 'locked';

const rejection = /\[rejected\]|non-fast-forward|fetch first/;

/** Pushes main. The git lock must be held. */
export const pushMain = async (
  repository: Repository
): Promise<'pushed' | 'push-failed' | 'push-blocked'> => {
  const pushed = await repository.git([
    'push',
    '-q',
    repository.remote,
    `HEAD:${repository.main}`,
  ]);
  if (pushed.code === 0) return 'pushed';
  if (!rejection.test(pushed.stderr)) {
    await repository.log('commit: push failed; will retry');
    return 'push-failed';
  }
  await repository.log(
    'commit: push rejected, someone else pushed; staying local'
  );
  await checkMain(repository, { rejected: true }).catch(() => undefined);
  return 'push-blocked';
};

/** add, commit, push. The git lock must be held. */
export const commitLocked = async (
  repository: Repository,
  message: string
): Promise<Exclude<CommitResult, 'locked'>> => {
  const { git } = repository;
  await git(['add', '-A']);
  const staged = (await git(['diff', '--cached', '--quiet'])).code !== 0;
  if (staged) {
    const committed = await git([
      '-c',
      'commit.gpgsign=false',
      'commit',
      '-qm',
      message,
    ]);
    // No identity lands here. It stays staged for the next run.
    if (committed.code !== 0) {
      await repository.log(
        `commit: not committed: ${committed.stderr.trim().split('\n')[0] ?? ''}`
      );
      return 'commit-failed';
    }
  }
  const local = staged ? 'committed' : 'clean';
  if (!(await repository.hasRemote())) return local;
  // Only main is ever pushed from here; a branch is pushed by whoever opens its PR.
  const head = (await git(['symbolic-ref', '--short', '-q', 'HEAD'])).stdout;
  if (head.trim() !== repository.main) return local;
  const ahead = await git([
    'rev-list',
    '--count',
    `${pushedRef(repository)}..HEAD`,
  ]);
  if (ahead.code === 0 && ahead.stdout.trim() === '0') return 'clean';
  if ((await repository.marker.read()) !== undefined) return 'push-blocked';
  return pushMain(repository);
};

export const commit = async (
  repository: Repository,
  message: string,
  waitMs: number
): Promise<CommitResult> => {
  const held = await repository.hold(waitMs);
  if (held === undefined) return 'locked';
  try {
    return await commitLocked(repository, message);
  } finally {
    held.release();
  }
};

const quoted = /^"|"$/g;
const renamed = /^.* -> /;
const shown = 5;
const baseName = (path: string): string =>
  path.replace(/\/+$/, '').split('/').at(-1) ?? path;

/** "self-edit: a.md,b.ts (session in <folder>)" from `git status --porcelain`. */
export const selfEditMessage = (porcelain: string, cwd = '?'): string => {
  const names = porcelain
    .split('\n')
    .filter((line) => line !== '')
    .map((line) =>
      baseName(line.slice(3).replace(renamed, '').replace(quoted, ''))
    );
  const files = [...new Set(names)].sort().slice(0, shown).join(',');
  return `self-edit: ${files || 'push'} (session in ${baseName(cwd)})`;
};

/** A Claude Code hook's input, as far as the self-commit hook reads it. */
export type HookInput = {
  readonly hook_event_name?: string | undefined;
  readonly cwd?: string | undefined;
  readonly tool_input?:
    | {
        readonly file_path?: string | undefined;
        readonly notebook_path?: string | undefined;
      }
    | undefined;
};

/** A PostToolUse for a file outside the repository is none of our business. Anything else (a Stop) is. */
export const concerns = (input: HookInput, root: string): boolean => {
  if (input.hook_event_name !== 'PostToolUse') return true;
  const file =
    input.tool_input?.file_path ?? input.tool_input?.notebook_path ?? '';
  return file.startsWith(`${root}/`);
};

/** The commit message after a wake, from the event that led to it. */
export const wakeMessage = ({
  source,
  schedule,
  tick,
  reason,
  ok,
}: {
  /** The event's source, e.g. `conversations` or `schedules`. */
  readonly source: string;
  /** The schedule's name, if the event was a firing. */
  readonly schedule: string | undefined;
  /** The name of the heartbeat's own schedule, and why its last tick woke. */
  readonly tick: string;
  readonly reason: string | undefined;
  readonly ok: boolean;
}): string => {
  const status = ok ? 'ok' : 'failed';
  if (schedule === undefined) return `${source}: ${status}`;
  if (schedule !== tick) return `${schedule}: ${status}`;
  return `${tick}: ${status}${reason === undefined ? '' : ` (${reason})`}`;
};
