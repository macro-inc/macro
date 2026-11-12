/**
 * Commits whatever the agent changed (notes, prompts, its charter, its code)
 * so its memory and self-edits have history, then brings main level with the
 * remote: pull --rebase, then push. A pull that conflicts is aborted, the
 * commits stay local, the owner hears once, and the next commit tries again.
 */
import { conflicted, settled } from './guard.ts';
import { type Repository, upstreamRef } from './repository.ts';

export type CommitResult =
  /** Nothing to commit and nothing to push. */
  | 'clean'
  /** Committed, and not pushed: there is no remote, or the checkout isn't on main. */
  | 'committed'
  | 'pushed'
  /** Not committed, e.g. no identity. The change stays staged for the next commit. */
  | 'commit-failed'
  /** The pull failed for a reason that isn't a conflict, e.g. the network. The next commit retries. */
  | 'pull-failed'
  /** The remote's main and the agent's commits conflict. The rebase was aborted, commits stay local, and the next commit retries. */
  | 'rebase-conflict'
  /** The push failed, e.g. someone pushed since the pull. The next commit pulls and retries. */
  | 'push-failed'
  /** The git lock stayed busy. The change stays in the tree for the next commit. */
  | 'locked';

const noRemoteMain = /couldn't find remote ref/;
const firstLine = (text: string): string =>
  text.trim().split('\n')[0]?.slice(0, 300) ?? '';

/** Rebases local main onto the remote's. The git lock must be held, and the checkout on main with nothing staged. */
export const pullMain = async (
  repository: Repository
): Promise<'pulled' | 'pull-failed' | 'rebase-conflict'> => {
  const { git, remote, main } = repository;
  const pulled = await git([
    '-c',
    'commit.gpgsign=false',
    '-c',
    'rebase.autoStash=false',
    'pull',
    '--rebase',
    '-q',
    remote,
    main,
  ]);
  if (pulled.code === 0) {
    await settled(repository);
    return 'pulled';
  }
  // A remote with no main yet has nothing to pull: the push makes it.
  if (noRemoteMain.test(pulled.stderr)) return 'pulled';
  // Only a rebase that started and stopped can be aborted; anything else failed before it.
  if ((await git(['rebase', '--abort'])).code !== 0) {
    await repository.log('commit: pull failed; will retry');
    return 'pull-failed';
  }
  const theirs = (
    await git(['rev-parse', '--verify', '-q', upstreamRef(repository)])
  ).stdout.trim();
  await repository.log(
    `commit: pulling ${theirs.slice(0, 12)} conflicts; aborted, staying local: ${firstLine(pulled.stdout || pulled.stderr)}`
  );
  await conflicted(repository, theirs);
  return 'rebase-conflict';
};

/** Pushes main. The git lock must be held. */
export const pushMain = async (
  repository: Repository
): Promise<'pushed' | 'push-failed'> => {
  const pushed = await repository.git([
    'push',
    '-q',
    repository.remote,
    `HEAD:${repository.main}`,
  ]);
  if (pushed.code === 0) return 'pushed';
  await repository.log(
    `commit: push failed; will retry: ${firstLine(pushed.stderr)}`
  );
  return 'push-failed';
};

/** Pulls main with --rebase, then pushes what is left to push. The git lock must be held. */
export const syncMain = async (
  repository: Repository,
  local: 'clean' | 'committed'
): Promise<Exclude<CommitResult, 'locked' | 'commit-failed'>> => {
  const pulled = await pullMain(repository);
  if (pulled !== 'pulled') return pulled;
  const ahead = await repository.git([
    'rev-list',
    '--count',
    `${upstreamRef(repository)}..HEAD`,
  ]);
  if (ahead.code === 0 && ahead.stdout.trim() === '0') return local;
  return pushMain(repository);
};

/** add, commit, pull --rebase, push. The git lock must be held. */
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
  // Only main is synced from here; a branch comes in through land.
  const head = (await git(['symbolic-ref', '--short', '-q', 'HEAD'])).stdout;
  if (head.trim() !== repository.main) return local;
  return syncMain(repository, local);
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
