/**
 * How code gets into the agent's repository: local main fast-forwards to a local
 * branch that is green, and the remote is told afterwards. Merging on GitHub
 * would mean pulling the result; only a status ever comes back from GitHub,
 * never code.
 *
 * The git lock is held from the first rebase to the last push, the CI wait
 * included. A fast-forward onto the exact SHA CI tested needs main to stand
 * still, and state is committed to main at any moment; without the lock
 * every state commit would send the branch back for another CI run. CI is
 * under a minute, a commit waits 60s and then leaves its change in the tree
 * for the next commit, so nothing is lost.
 *
 * While the repository has no remote there is no PR and no CI: green is the
 * repository's own check passing on the exact SHA, and nothing is pushed.
 */
import { isoText } from '@macro-inc/muppet/utilities/time';
import { commitLocked, pushMain } from './commit.ts';
import { checkMain } from './guard.ts';
import { branchRef, type Repository } from './repository.ts';

export type CheckRun = {
  readonly name: string;
  readonly status: string;
  readonly conclusion: string | null;
  readonly head_sha: string;
  readonly app: string | null;
};
export type CiState = 'green' | 'red' | 'pending';
export type Pr = {
  readonly number: number;
  readonly title: string;
  readonly baseRefName: string;
};

const passed: readonly string[] = ['success', 'neutral', 'skipped'];
const actions = 'github-actions';

/** Green means the check job ran on exactly this SHA, on GitHub Actions, and nothing on that SHA failed. */
export const ciVerdict = (
  runs: readonly CheckRun[],
  sha: string,
  job: string
): CiState => {
  const mine = runs.filter(
    (run) => run.head_sha === sha && run.app === actions
  );
  if (
    mine.some(
      (run) =>
        run.status === 'completed' && !passed.includes(run.conclusion ?? '')
    )
  )
    return 'red';
  if (mine.some((run) => run.status !== 'completed')) return 'pending';
  return mine.some((run) => run.name === job && run.conclusion === 'success')
    ? 'green'
    : 'pending';
};

/** `| 2026-11-03T10:15 | repo#n | title | what |`: one row of the merge log. */
export const mergeRow = (
  repo: string,
  number: string | number,
  pr: { readonly title: string; readonly mergedAt: string | null },
  what = ''
): string =>
  `| ${pr.mergedAt === null ? 'null' : pr.mergedAt.slice(0, 16)} | ${repo.replace(/^[^/]*\//, '')}#${number} | ${pr.title} | ${what} |`;

/** The row for a landing with no PR, while there is no remote. */
export const localRow = (
  branch: string,
  sha: string,
  at: string,
  what: string
): string =>
  `| ${at.slice(0, 16)} | local@${sha.slice(0, 12)} | ${branch} | ${what} |`;

export type LandDeps = {
  /** The GitHub side, or undefined while the repository has no remote. */
  readonly github:
    | undefined
    | {
        /** `owner/name`. */
        readonly repo: string;
        /** The branch's open PR, or undefined. */
        readonly pr: (branch: string) => Promise<Pr | undefined>;
        readonly merged: (number: number) => Promise<boolean>;
      };
  /** Whether the SHA is green: CI on GitHub, or the repository's own check with no remote. */
  readonly ci: (sha: string) => Promise<CiState>;
  /** Installs dependencies. Only called when a manifest changed. */
  readonly install: () => Promise<unknown>;
  readonly manifests: readonly string[];
  /** A fresh empty directory outside the repository, and its removal. */
  readonly scratch: {
    readonly make: () => Promise<string>;
    readonly remove: (path: string) => Promise<void>;
  };
  readonly appendMerge: (row: string) => Promise<void>;
  readonly pollMs: number;
  readonly ciTimeoutMs: number;
  readonly lockWaitMs: number;
  readonly mergedPollMs: number;
  readonly mergedTimeoutMs: number;
};

export type Landed =
  | {
      readonly status: 'landed';
      readonly sha: string;
      /** The PR that landed, or undefined with no remote. */
      readonly pr: number | undefined;
      /** Whether GitHub marked the PR merged. */
      readonly merged: boolean;
    }
  | { readonly status: 'refused'; readonly reason: string };

const refuse = (reason: string): Landed => ({ status: 'refused', reason });
const attempts = 3;
const short = (sha: string): string => sha.slice(0, 12);

/** Waits until `check` is no longer pending, or the time is up. */
const settled = async <Value>(
  { clock }: Pick<Repository, 'clock'>,
  check: () => Promise<Value>,
  pending: (value: Value) => boolean,
  pollMs: number,
  timeoutMs: number
): Promise<Value> => {
  const deadline = clock.now().add({ milliseconds: timeoutMs });
  for (;;) {
    const value = await check();
    if (!pending(value) || Temporal.Instant.compare(clock.now(), deadline) >= 0)
      return value;
    await clock.sleep(pollMs);
  }
};

/** The worktree that has `branch` checked out, from `git worktree list --porcelain`. */
export const worktreeOf = (
  listing: string,
  branch: string
): string | undefined =>
  listing
    .split('\n\n')
    .find((block) => block.split('\n').includes(`branch ${branchRef(branch)}`))
    ?.match(/^worktree (.+)$/m)?.[1];

/** Rebases in the worktree that has the branch out, or a temporary one: the live checkout never leaves main. Returns why it failed, or undefined. */
const rebaseOnMain = async (
  { git, main }: Repository,
  branch: string,
  scratch: LandDeps['scratch']
): Promise<string | undefined> => {
  const existing = worktreeOf(
    (await git(['worktree', 'list', '--porcelain'])).stdout,
    branch
  );
  const temporary = existing === undefined ? await scratch.make() : undefined;
  const where = existing ?? temporary ?? '';
  try {
    if (temporary !== undefined) {
      const added = await git(['worktree', 'add', '-q', temporary, branch]);
      if (added.code !== 0)
        return `can't check out ${branch} to rebase it: ${added.stderr.trim().slice(0, 200)}`;
    }
    const rebased = await git(
      ['-c', 'commit.gpgsign=false', 'rebase', '-q', main],
      { cwd: where }
    );
    if (rebased.code === 0) return undefined;
    await git(['rebase', '--abort'], { cwd: where });
    return `${branch} doesn't rebase cleanly on local ${main}; rebase it yourself and rerun: ${(rebased.stderr || rebased.stdout).trim().slice(0, 300)}`;
  } finally {
    if (temporary !== undefined) {
      await git(['worktree', 'remove', '--force', temporary]);
      await scratch.remove(temporary);
    }
  }
};

const tampered = (where: string): string =>
  `${where} (the owner has the alarm). Nothing lands until that's settled.`;

export const land = async (
  repository: Repository,
  branch: string,
  what: string,
  deps: LandDeps
): Promise<Landed> => {
  const { git, main, remote } = repository;
  const { github } = deps;
  const head = (await git(['symbolic-ref', '--short', '-q', 'HEAD'])).stdout;
  if (head.trim() !== main)
    return refuse(
      `the live checkout is on ${head.trim() || 'a detached HEAD'}, not ${main}.`
    );
  if (
    branch === main ||
    branch.startsWith('-') ||
    (await git(['rev-parse', '--verify', '-q', branchRef(branch)])).code !== 0
  )
    return refuse(`no local branch ${branch} to land.`);
  const pr = await github?.pr(branch);
  if (github !== undefined) {
    if (pr === undefined)
      return refuse(
        `${branch} has no open PR, so CI won't run on it. Push it and open one.`
      );
    if (pr.baseRefName !== main)
      return refuse(`PR #${pr.number} targets ${pr.baseRefName}, not ${main}.`);
  }

  const held = await repository.hold(deps.lockWaitMs);
  if (held === undefined) return refuse('the git lock stayed busy; rerun.');
  try {
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      // Anything uncommitted goes on main first, so the branch lands on top of it.
      const flushed = await commitLocked(
        repository,
        `land: state before ${branch}`
      );
      if (flushed === 'push-blocked')
        return refuse(tampered("someone else pushed to GitHub's main"));
      const guard = await checkMain(repository);
      if (guard === 'alarmed' || guard === 'already')
        return refuse(tampered("GitHub's main isn't what I last pushed"));
      if (guard === 'unknown' && github !== undefined)
        return refuse("can't read GitHub's main; rerun.");

      const onMain = await git([
        'merge-base',
        '--is-ancestor',
        main,
        branchRef(branch),
      ]);
      if (onMain.code !== 0) {
        const failed = await rebaseOnMain(repository, branch, deps.scratch);
        if (failed !== undefined) return refuse(failed);
      }
      const sha = (await git(['rev-parse', branchRef(branch)])).stdout.trim();
      if (github !== undefined) {
        const pushed = await git([
          'push',
          '-q',
          '--force',
          remote,
          `${sha}:${branchRef(branch)}`,
        ]);
        if (pushed.code !== 0)
          return refuse(
            `can't push ${branch}: ${pushed.stderr.trim().slice(0, 300)}`
          );
      }

      const ci = await settled(
        repository,
        () => deps.ci(sha),
        (state) => state === 'pending',
        deps.pollMs,
        deps.ciTimeoutMs
      );
      if (ci === 'red')
        return refuse(
          `the check failed on ${short(sha)}; ${main} didn't move.`
        );
      if (ci === 'pending')
        return refuse(
          `the check didn't finish on ${short(sha)} in time; ${main} didn't move. Rerun.`
        );

      const before = (await git(['rev-parse', main])).stdout.trim();
      // Touches only the files the branch changed; refuses rather than overwrite someone's uncommitted edit.
      const forwarded = await git(['merge', '-q', '--ff-only', sha]);
      if (forwarded.code !== 0) {
        await repository.log(
          `land: fast-forward refused, trying again: ${forwarded.stderr.trim().slice(0, 300)}`
        );
        continue;
      }
      const changed = (
        await git(['diff', '--name-only', before, sha])
      ).stdout.split('\n');
      if (deps.manifests.some((manifest) => changed.includes(manifest)))
        await deps.install();

      const at = isoText(repository.clock.now());
      if (github === undefined || pr === undefined) {
        await deps.appendMerge(
          localRow(branch, sha, at, what || `landed ${short(sha)}`)
        );
        await commitLocked(repository, `merge log: ${branch}`);
        return { status: 'landed', sha, pr: undefined, merged: false };
      }

      const pushed = await pushMain(repository);
      if (pushed === 'push-blocked')
        return refuse(
          `${short(sha)} is on local ${main}, but GitHub rejected the push: someone else pushed (the owner has the alarm).`
        );
      if (pushed === 'push-failed')
        await repository.log(
          `land: ${short(sha)} is on local ${main}; the push failed and the next commit retries it.`
        );
      const merged =
        pushed === 'pushed' &&
        (await settled(
          repository,
          () => github.merged(pr.number).catch(() => false),
          (done) => !done,
          deps.mergedPollMs,
          deps.mergedTimeoutMs
        ));
      if (merged) await git(['push', '-q', remote, '--delete', branch]);
      else
        await repository.log(
          `land: PR #${pr.number} isn't marked merged yet; its branch stays on GitHub.`
        );
      await deps.appendMerge(
        mergeRow(
          github.repo,
          pr.number,
          { title: pr.title, mergedAt: at },
          what || `landed ${short(sha)}`
        )
      );
      await commitLocked(repository, `merge log: #${pr.number}`);
      return { status: 'landed', sha, pr: pr.number, merged };
    }
    return refuse(
      `the live checkout kept refusing the fast-forward; ${branch} and ${main} are unchanged. Look at its uncommitted changes.`
    );
  } finally {
    held.release();
  }
};
