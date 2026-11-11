/**
 * The heartbeat's real adapters, built from the context: git and gh run as
 * the agent, and the pieces a tick is made of. Everything here is thin; what
 * it feeds is decided in the files it imports.
 */
import type { Woke } from '@macro-inc/muppet/core/agent';
import type { Schedules } from '@macro-inc/muppet/utilities/schedules';
import { z } from 'zod';
import { readJson, writeJson } from '../../context/disk.ts';
import { githubToken } from '../../context/identity.ts';
import { output } from '../../context/shell.ts';
import type { People } from '../../contracts.ts';
import type { Chat } from '../chat/macro.ts';
import { type RepositoryState, type Sources, snapshot } from './collect.ts';
import { commit } from './commit.ts';
import { limits, logs, settings } from './config.ts';
import type { HeartbeatContext } from './context.ts';
import {
  type CheckRun,
  ciVerdict,
  type LandDeps,
  worktreeCheck,
} from './land.ts';
import { tickRequest } from './prompt.ts';
import { prune, type Rule } from './prune.ts';
import { githubRepo, type Repository } from './repository.ts';
import { type Misplaced, misplaced } from './state.ts';
import { type Beat, Cursor, mentionedIds } from './tick.ts';

/** What the heartbeat needs from the rest of the agent: the scheduler, Macro (from chat), and people's cards if the people area is there. */
export type Needs = HeartbeatContext & {
  readonly schedules: Schedules;
  readonly chat: Pick<Chat, 'dm'>;
  readonly people?: People;
};

/** Chat's history of each channel: its owner and directory, as chat's context names them. */
const chatOwner = 'chat';
const chatHistory = 'history';

/** Runs a program as the agent and returns its exit, never throwing on a failure. */
const asAgent =
  ({ shell, environment }: Pick<Needs, 'shell' | 'environment'>) =>
  async (
    argv: readonly string[],
    options: { readonly cwd?: string; readonly timeoutMs?: number } = {}
  ) =>
    shell.run(argv, { ...options, env: await environment() });

/** Whether the agent can reach GitHub as itself. */
const hasGithub = ({ credentials }: Pick<Needs, 'credentials'>) =>
  credentials.has(githubToken);

/** Thrown by what can't work without GitHub, naming what to add. */
export const needsGithub = (what: string): Error =>
  new Error(
    `${what} needs GitHub: add the ${githubToken} credential (a token for the agent's GitHub account) with setCredential.`
  );

export const repositoryOf = (context: Needs): Repository => {
  const { config, heartbeat, disk, clock, log, chat } = context;
  // Commits are the agent's own whether or not it has a GitHub account: its
  // name and email come from its settings. The remote authenticates through
  // the credential helper its supervisor set up, never a token here.
  const git: Repository['git'] = async (args, { cwd } = {}) =>
    context.shell.run([settings.git, '-C', cwd ?? config.root, ...args], {
      env: {
        ...(await context.environment()),
        GIT_AUTHOR_NAME: config.identity.name,
        GIT_AUTHOR_EMAIL: config.identity.email,
        GIT_COMMITTER_NAME: config.identity.name,
        GIT_COMMITTER_EMAIL: config.identity.email,
      },
    });
  return {
    git,
    remote: settings.remote,
    main: settings.main,
    hasRemote: async () =>
      (await git(['remote', 'get-url', '--push', settings.remote])).code === 0,
    dm: async (text) => {
      await chat.dm(config.owner, text);
    },
    marker: {
      read: async () =>
        (await disk.read(heartbeat.paths.conflict))?.trim() || undefined,
      write: (sha) => disk.write(heartbeat.paths.conflict, `${sha}\n`),
      clear: () => disk.remove(heartbeat.paths.conflict),
    },
    hold: (waitMs) => heartbeat.lock(heartbeat.paths.gitLock, waitMs),
    clock,
    log: (line) => log.event(logs.heartbeat, { line }),
  };
};

/** What is wrong with the agent's repository: a pull that conflicts, and files git keeps that it shouldn't. */
export const repositoryStateOf = async (
  context: Needs
): Promise<RepositoryState> => ({
  conflict: await repositoryOf(context).marker.read(),
  misplaced: await misplacedNow(context),
});

/** Which files under the state directory git tracks that their bucket says it shouldn't. */
export const misplacedNow = async (context: Needs): Promise<Misplaced> => {
  // No state directory yet: nothing is recorded, so nothing is tracked.
  if (!(await context.disk.exists(context.heartbeat.stateRoot)))
    return { local: [], stray: [] };
  const tracked = await repositoryOf(context).git(['ls-files'], {
    cwd: context.heartbeat.stateRoot,
  });
  if (tracked.code !== 0)
    throw new Error(
      `can't list tracked state: ${tracked.stderr.trim().slice(0, 300)}`
    );
  return misplaced(tracked.stdout.split('\n').filter((path) => path !== ''));
};

/** The snapshot's real sources. */
export const sourcesOf = (context: Needs): Sources => ({
  repository: () => repositoryStateOf(context),
  sections: () =>
    Promise.all(context.heartbeat.sections.map((section) => section())),
});

export const collectNow = (context: Needs): Promise<string> =>
  snapshot(sourcesOf(context));

/** Every rule that keeps the agent's files bounded: its logs, chat's histories, and what other areas added. */
export const pruneRules = async ({
  config,
  state,
  join,
  heartbeat,
}: Needs): Promise<readonly Rule[]> => [
  ...(await heartbeat.tree.entries(heartbeat.buckets.log))
    .filter(({ directory }) => directory)
    .map(
      ({ name }): Rule => ({
        kind: 'logs',
        directory: join(heartbeat.buckets.log, name),
        days: config.keep.logDays,
        lines: config.keep.logLines,
      })
    ),
  {
    kind: 'trim',
    directory: join(state.private(chatOwner), chatHistory),
    lines: config.keep.historyLines,
  },
  ...heartbeat.prune,
];

export const pruneNow = async (context: Needs) =>
  prune({
    rules: await pruneRules(context),
    tree: context.heartbeat.tree,
    disk: context.disk,
    join: context.join,
    now: context.clock.now(),
  });

const CheckRuns = z.array(
  z.object({
    name: z.string(),
    status: z.string(),
    conclusion: z.string().nullable(),
    head_sha: z.string(),
    app: z.string().nullable(),
  })
);

const PrList = z.array(
  z.object({ number: z.number(), title: z.string(), baseRefName: z.string() })
);

/** What a landing needs, for the repository as it is now: the repository's own check, or GitHub's PR and CI with a GitHub remote and the agent's token. */
export const landDepsOf = async (
  context: Needs,
  repository: Repository
): Promise<LandDeps> => {
  const { config, heartbeat, disk, log, shell } = context;
  const run = asAgent(context);
  const url =
    (await hasGithub(context)) && (await repository.hasRemote())
      ? await repository.git(['remote', 'get-url', '--push', settings.remote])
      : undefined;
  const repo = url?.code === 0 ? githubRepo(url.stdout) : undefined;
  const gh = async (args: readonly string[]): Promise<unknown> =>
    JSON.parse(
      await output(shell, [settings.gh, ...args], {
        env: await context.environment(),
        timeoutMs: limits.gh,
      })
    );
  const localCheck = worktreeCheck({
    repository,
    checkouts: heartbeat.scratch,
    run: (argv, { cwd, install }) =>
      run(argv, {
        cwd,
        timeoutMs: install ? limits.install : limits.ciTimeout,
      }),
    check: [settings.bun, 'run', settings.checkScript],
    install: [settings.bun, 'install', '--frozen-lockfile'],
    manifests: settings.manifests,
    failed: (sha, text) =>
      log.event(logs.heartbeat, {
        line: `land: the check failed on ${sha.slice(0, 12)}`,
        output: text.trim().slice(-2000),
      }),
  });
  return {
    github:
      repo === undefined
        ? undefined
        : {
            repo,
            pr: async (branch) =>
              PrList.parse(
                await gh([
                  'pr',
                  'list',
                  '-R',
                  repo,
                  '--head',
                  branch,
                  '--state',
                  'open',
                  '--json',
                  'number,title,baseRefName',
                ])
              )[0],
            merged: async (number) =>
              z
                .object({ state: z.string() })
                .parse(
                  await gh([
                    'pr',
                    'view',
                    String(number),
                    '-R',
                    repo,
                    '--json',
                    'state',
                  ])
                ).state === 'MERGED',
          },
    ci:
      repo === undefined
        ? localCheck
        : // A blip reading CI is "not yet": the deadline decides.
          async (sha) =>
            ciVerdict(
              await gh([
                'api',
                `repos/${repo}/commits/${sha}/check-runs?per_page=100`,
                '--jq',
                '[.check_runs[] | {name, status, conclusion, head_sha, app: .app.slug}]',
              ])
                .then((runs): readonly CheckRun[] => CheckRuns.parse(runs))
                .catch((): readonly CheckRun[] => []),
              sha,
              settings.checkJob
            ),
    install: () =>
      run([settings.bun, 'install', '--frozen-lockfile'], {
        cwd: config.root,
        timeoutMs: limits.install,
      }),
    manifests: settings.manifests,
    scratch: heartbeat.scratch,
    appendMerge: (row) => disk.append(heartbeat.paths.merges, `${row}\n`),
    restart: heartbeat.restart,
    pollMs: limits.ciPoll,
    ciTimeoutMs: limits.ciTimeout,
    lockWaitMs: limits.landLockWait,
    mergedPollMs: limits.mergedPoll,
    mergedTimeoutMs: limits.mergedTimeout,
  };
};

/** A merged PR's title and when it merged, from GitHub. */
export const mergedPr = async (
  context: Needs,
  repo: string,
  number: number
): Promise<{ readonly title: string; readonly mergedAt: string | null }> => {
  if (!(await hasGithub(context))) throw needsGithub('Reading a merged PR');
  return z
    .object({ title: z.string(), mergedAt: z.string().nullable() })
    .parse(
      JSON.parse(
        await output(
          context.shell,
          [
            settings.gh,
            'pr',
            'view',
            String(number),
            '-R',
            repo,
            '--json',
            'title,mergedAt',
          ],
          { env: await context.environment(), timeoutMs: limits.gh }
        )
      )
    );
};

/** The standing request of a tick, with this agent's paths in it. */
export const requestOf = ({ heartbeat }: Needs): string =>
  tickRequest({ notes: heartbeat.paths.notes });

/** Everything one tick touches, for the agent that is running. */
export const beatOf = (
  context: Needs,
  wake: (prompt: string) => Promise<Woke>
): Beat => {
  const { config, heartbeat, disk, clock, log, people } = context;
  const repository = repositoryOf(context);
  return {
    now: clock.now,
    digest: heartbeat.digest,
    commit: (message) => commit(repository, message, limits.commitLockWait),
    collect: () => collectNow(context),
    cursor: {
      read: () => readJson(disk, heartbeat.paths.cursor, Cursor),
      write: (cursor) => writeJson(disk, heartbeat.paths.cursor, cursor),
    },
    last: {
      read: () => disk.read(heartbeat.paths.snapshot),
      write: (text) => disk.write(heartbeat.paths.snapshot, text),
    },
    prune: () => pruneNow(context),
    people: async (text) =>
      (await people?.cards(mentionedIds(text, config.owner), 'reply')) ?? '',
    request: requestOf(context),
    wake,
    log: (entry) => log.event(logs.heartbeat, entry),
  };
};
