/**
 * The heartbeat's capabilities: the agent's own clock, the hygiene of what
 * it records, and how its repository changes. Each is what the tick, a hook or
 * a schedule runs, so it can also be run by hand and read in a log.
 */
import { behavior } from '@macro-inc/muppet/core/behavior';
import { module } from '@macro-inc/muppet/core/capability';
import type { Schedule } from '@macro-inc/muppet/utilities/schedules/schedule';
import type { Changed } from '@macro-inc/muppet/utilities/schedules/schedules';
import { z } from 'zod';
import { lastLines, readJson } from '../../context/disk.ts';
import { buckets } from '../../context/state.ts';
import {
  type CommitResult,
  commit as commitChanges,
  concerns,
  selfEditMessage,
} from './commit.ts';
import { limits, type logs } from './config.ts';
import { land as landBranch, mergeRow } from './land.ts';
import {
  collectNow,
  landDepsOf,
  mergedPr,
  misplacedNow,
  type Needs,
  pruneNow,
  repositoryOf,
} from './live.ts';
import type { Act } from './schedules.ts';
import { bucketNames, what } from './state.ts';
import { Cursor, snapshotHash, wakeReason } from './tick.ts';

/**
 * Whether your next heartbeat tick would wake you, and why, with the
 * snapshot it would wake you on.
 *
 * Every 30 minutes your heartbeat commits your repository, pulls and pushes
 * it, prunes, and builds a snapshot: what is wrong with your repository,
 * and what the other areas of you watch. It wakes you when the snapshot
 * changed and has something in it. This is a dry run of that decision:
 * nothing is recorded and you aren't woken. `lastRun` is when a tick last
 * woke you.
 */
export const heartbeatCheck = async (
  context: Needs
): Promise<{
  readonly wake: boolean;
  readonly reason?: string;
  readonly snapshot: string;
  readonly hash: string;
  readonly lastHash?: string;
  readonly lastRun?: string;
}> => {
  const { heartbeat, disk } = context;
  const snapshot = (await collectNow(context)).trimEnd();
  const hash = snapshotHash(heartbeat.digest, snapshot);
  const cursor = await readJson(disk, heartbeat.paths.cursor, Cursor);
  const reason = wakeReason({ hash, lastHash: cursor?.hash, snapshot });
  return {
    wake: reason !== undefined,
    ...(reason === undefined ? {} : { reason }),
    snapshot,
    hash,
    ...(cursor === undefined ? {} : { lastHash: cursor.hash }),
    ...(cursor?.lastRun === undefined ? {} : { lastRun: cursor.lastRun }),
  };
};

/**
 * Trim your logs and histories to their limits, and drop old per-run files.
 *
 * Your heartbeat does this on every tick. Per-run logs and recordings
 * older than `keep.logDays` go; `.jsonl` logs keep their newest
 * `keep.logLines` and a channel's history its newest `keep.historyLines`
 * (both trimmed only at twice the cap). The limits are in your config.
 */
export const prune = (
  context: Needs
): Promise<{ readonly removed: number; readonly trimmed: number }> =>
  pruneNow(context);

/** `value` trimmed, refusing one that is empty: a blank message or branch is a mistake, never a choice. */
const filled = (value: string, what: string): string => {
  const trimmed = value.trim();
  if (trimmed === '') throw new Error(`${what} must not be empty`);
  return trimmed;
};

/**
 * Commit everything changed in your own repository, then pull its remote's
 * main with --rebase and push.
 *
 * This happens by itself after every wake and on every heartbeat tick, so you
 * rarely need it: use it when a change must be in history before something
 * else reads it, or to take in what your owner pushed. Only main is pulled
 * and pushed. Results: clean (nothing to commit or push), committed (local
 * only: no remote, or not on main), pushed, commit-failed (it stays staged),
 * pull-failed and push-failed (retried by the next commit), rebase-conflict
 * (your commits and the remote's conflict: the rebase was aborted, your
 * commits stay local, your owner has one alarm, and the next commit tries
 * again), locked (a landing holds the lock; the change waits for the next
 * commit). Never pull, rebase or reset main in this checkout yourself.
 * `message` mustn't be blank.
 */
export const commit = async (
  context: Needs,
  input: { readonly message: string }
): Promise<{ readonly result: CommitResult }> => {
  const message = filled(input.message, 'message');
  return {
    result: await commitChanges(
      repositoryOf(context),
      message,
      limits.commitLockWait
    ),
  };
};

const Hook = z.object({
  hook_event_name: z.string().optional(),
  cwd: z.string().optional(),
  tool_input: z
    .object({
      file_path: z.string().optional(),
      notebook_path: z.string().optional(),
    })
    .optional(),
});

/**
 * A Claude Code hook: commit your repository when a session outside your runs
 * changed it.
 *
 * Its input is the hook's own JSON, so the hook command is `bin/agent
 * commitSelfEdit -` (PostToolUse on Write|Edit|NotebookEdit, and Stop for
 * edits made through Bash). A PostToolUse for a file outside this repository
 * is skipped, and so is a tree with nothing to commit or push. The message
 * names the files and the session's folder.
 */
export const commitSelfEdit = async (
  context: Needs,
  // Claude Code sends far more than is read here, and adds to it: a closed
  // type would refuse the hook's own JSON. What is read is parsed out.
  hook: Readonly<Record<string, unknown>>
): Promise<{ readonly result: CommitResult | 'skipped' }> => {
  const input = Hook.parse(hook);
  if (!concerns(input, context.config.root)) return { result: 'skipped' };
  const repository = repositoryOf(context);
  const status = await repository.git(['status', '--porcelain']);
  if (status.code !== 0) return { result: 'skipped' };
  return {
    result: await commitChanges(
      repository,
      selfEditMessage(status.stdout, input.cwd),
      limits.commitLockWait
    ),
  };
};

/**
 * Land a green branch on your repository's main. The only way code gets into
 * it.
 *
 * Branch from local main in a worktree under `.worktrees/`, commit, then land
 * the branch. Under the git lock it commits what's pending on main and pulls
 * the remote's, rebases the branch on local main if main moved, runs `bun run
 * check` in a fresh worktree of that exact commit, fast-forwards local main
 * (the live tree changes only in the branch's files), writes a row in the
 * merge log, and pushes. Then, when you are supervised, you restart onto the
 * new code (`restarting`): this run ends there.
 *
 * Only with a GitHub remote and the AGENT_GITHUB_TOKEN credential is green
 * instead CI's `check` job on the branch's open PR against main, which GitHub
 * marks merged by itself once main is pushed. Never merge a PR on GitHub.
 *
 * Run it from the live checkout (the one on main). A refusal, a red check
 * included, says why and leaves main where it was. `branch` mustn't be blank.
 */
export const land = async (
  context: Needs,
  input: { readonly branch: string; readonly what?: string }
): Promise<
  | {
      readonly status: 'landed';
      readonly sha: string;
      readonly pr?: number;
      readonly merged: boolean;
      readonly restarting: boolean;
    }
  | { readonly status: 'refused'; readonly reason: string }
> => {
  const branch = filled(input.branch, 'branch');
  const { what } = input;
  const repository = repositoryOf(context);
  const landed = await landBranch(
    repository,
    branch,
    (what ?? '').trim(),
    await landDepsOf(context, repository)
  );
  if (landed.status === 'refused') return landed;
  const { pr, ...rest } = landed;
  return pr === undefined ? rest : { ...rest, pr };
};

const ownerAndName = /^[\w.-]+\/[\w.-]+$/;

/**
 * Add a merged PR to your merge log, so merges are searchable.
 *
 * Every PR you merge on any repository gets a row right after the merge:
 * when, which PR, its title, and `what` it did in a few words. `repo` is
 * `owner/name`, and `number` a positive integer. Landings on your own
 * repository are logged by land itself. It reads the PR from GitHub, so it
 * needs the AGENT_GITHUB_TOKEN credential.
 */
export const logMerge = async (
  context: Needs,
  {
    repo,
    number,
    what,
  }: { readonly repo: string; readonly number: number; readonly what?: string }
): Promise<{ readonly row: string }> => {
  if (!ownerAndName.test(repo))
    throw new Error(`repo must be owner/name, not "${repo}"`);
  if (!Number.isInteger(number) || number <= 0)
    throw new Error('number must be a positive integer');
  const row = mergeRow(
    repo,
    number,
    await mergedPr(context, repo, number),
    (what ?? '').trim()
  );
  await context.disk.append(context.heartbeat.paths.merges, `${row}\n`);
  return { row };
};

/**
 * Where everything you record lives, and whether git keeps it.
 *
 * Everything is under one state directory, in one of four buckets, and the
 * bucket is the rule for whether it is committed: choose a new file's bucket
 * by what the data is, and anything about or from a person is `private`. Each
 * area has its own directory in each bucket, which only it writes. With
 * `owner`, the files that owner has in each bucket.
 */
export const stateWhere = async (
  { heartbeat, join }: Needs,
  { owner }: { readonly owner?: string }
): Promise<{
  readonly root: string;
  readonly buckets: readonly {
    readonly bucket: string;
    readonly committed: boolean;
    readonly what: string;
    readonly path: string;
    /** The areas with a directory in this bucket, or the owner's files. */
    readonly holds: readonly string[];
  }[];
}> => ({
  root: heartbeat.stateRoot,
  buckets: await Promise.all(
    bucketNames.map(async (bucket) => {
      const path =
        owner === undefined
          ? heartbeat.buckets[bucket]
          : join(heartbeat.buckets[bucket], owner);
      return {
        bucket,
        committed: buckets[bucket].committed,
        what: what[bucket],
        path,
        holds: (await heartbeat.tree.entries(path)).map(
          ({ name, directory }) => (directory ? `${name}/` : name)
        ),
      };
    })
  ),
});

/**
 * Check that git tracks nothing its bucket says it shouldn't.
 *
 * `local` lists files git tracks in a bucket that is never committed
 * (people's data or logs that would be pushed); `stray` lists tracked files
 * under the state directory in no bucket at all. Both empty means `ok`. Fix
 * one with `git rm --cached <file>` and by moving it where it belongs.
 */
export const stateCheck = async (
  context: Needs
): Promise<{
  readonly ok: boolean;
  readonly local: readonly string[];
  readonly stray: readonly string[];
}> => {
  const { local, stray } = await misplacedNow(context);
  return {
    ok: local.length === 0 && stray.length === 0,
    local: [...local],
    stray: [...stray],
  };
};

/** `value`, refusing an empty one: an act with nothing to say or watch does nothing when it fires. */
const unlessEmpty = (
  value: string | undefined,
  what: string
): string | undefined => {
  if (value === '') throw new Error(`${what} must not be empty`);
  return value;
};

/**
 * Add a schedule that acts by itself when it fires: a line to your owner, or
 * a wake with a request.
 *
 * A plain schedule (setSchedule) does nothing until a handler acts on its
 * name; this one carries what to do. Give exactly one of `dmOwner` (that line
 * goes to your owner's DM; no model runs, so a reminder costs nothing) or `wake` (you
 * are woken with that request, which must stand alone: you won't remember
 * setting it). With `ifFile`, each firing does nothing until that file
 * exists; then it acts once and the schedule removes itself, so a watch is an
 * `every` schedule with `ifFile`. `schedule` is as setSchedule takes it, e.g.
 * { at: "2026-11-09T20:00:00Z" } or { every: "10m" }; resolve "in 3 hours" to
 * an instant yourself. It replaces a schedule by the same name. Remove it
 * with removeSchedule. `dmOwner`, `wake` and `ifFile` mustn't be empty.
 */
export const scheduleAction = async (
  { schedules }: Needs,
  input: {
    readonly name: string;
    readonly schedule: Schedule;
    readonly dmOwner?: string;
    readonly wake?: string;
    readonly ifFile?: string;
  }
): Promise<Changed> => {
  const { name, schedule } = input;
  const dmOwner = unlessEmpty(input.dmOwner, 'dmOwner');
  const wake = unlessEmpty(input.wake, 'wake');
  const ifFile = unlessEmpty(input.ifFile, 'ifFile');
  if ((dmOwner === undefined) === (wake === undefined))
    return { kind: 'invalid', error: 'give exactly one of dmOwner or wake' };
  const act: Act = {
    ...(dmOwner === undefined ? {} : { dmOwner }),
    ...(wake === undefined ? {} : { wake }),
    ...(ifFile === undefined ? {} : { ifFile }),
  };
  return schedules.set(name, { ...schedule, data: act });
};

const reportMax = 500;

/**
 * What your heartbeat and your schedules have done lately, from their logs.
 *
 * `heartbeat` has a line per tick (whether it woke you, why, how the run
 * ended) and per commit or landing that said something; `schedules` has a
 * line per firing of any schedule. Newest last. `count` is how many lines, a
 * whole number from 1 to 500; 20 by default.
 */
export const clockReport = async (
  { disk, log }: Needs,
  {
    stream,
    count,
  }: {
    readonly stream: (typeof logs)[keyof typeof logs];
    readonly count?: number;
  }
): Promise<readonly unknown[]> => {
  if (
    count !== undefined &&
    (!Number.isInteger(count) || count <= 0 || count > reportMax)
  )
    throw new Error(`count must be a whole number from 1 to ${reportMax}`);
  return lastLines((await disk.read(log.file(stream))) ?? '', count ?? 20).map(
    (line): unknown => {
      try {
        return JSON.parse(line);
      } catch {
        return line;
      }
    }
  );
};

export const heartbeatModule = module({
  name: 'heartbeat',
  summary:
    'Your own clock, the hygiene of what you record, and how your repository changes: commits, landings and the merge log.',
  file: import.meta.path,
  functions: {
    heartbeatCheck,
    prune,
    commit,
    commitSelfEdit,
    land,
    logMerge,
    stateWhere,
    stateCheck,
    scheduleAction,
    clockReport,
  },
});

export const heartbeatCapabilities =
  behavior<Needs>().capability(heartbeatModule);
