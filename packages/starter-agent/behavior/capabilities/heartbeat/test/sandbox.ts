/**
 * Real git repositories in a temporary directory, for the tests of what
 * commits and lands: a bare remote, the live checkout on main, and
 * whoever else has write access. Nothing here reaches a network.
 */
import { disk, shell } from '../../../context/index.ts';
import { output } from '../../../context/shell.ts';
import { fixedClock } from '../../../context/test/fakes.ts';
import type { LandDeps } from '../land.ts';
import type { Repository } from '../repository.ts';

const identity = {
  GIT_AUTHOR_NAME: 't',
  GIT_AUTHOR_EMAIL: 't@t',
  GIT_COMMITTER_NAME: 't',
  GIT_COMMITTER_EMAIL: 't@t',
};

export type Sandbox = Awaited<ReturnType<typeof sandbox>>;

export const sandbox = async () => {
  const root = (await output(shell, ['mktemp', '-d'])).trim();
  const live = `${root}/live`;
  const other = `${root}/other`;
  const remote = `${root}/remote.git`;
  const env: Record<string, string | undefined> = { ...identity };
  const raw = (directory: string, args: readonly string[]) =>
    shell.run(['git', '-C', directory, ...args], { env });
  /** Runs git, throws if it fails, and returns what it printed. */
  const git = (directory: string, ...args: readonly string[]) =>
    output(shell, ['git', '-C', directory, ...args], { env: identity });
  const write = (path: string, text: string) => disk.write(path, text);

  await output(shell, ['git', 'init', '-q', '--bare', '-b', 'main', remote]);
  await output(shell, ['git', 'clone', '-q', remote, live], { env: identity });
  await write(`${live}/.gitignore`, 'state/private/\nstate/run/\nstate/log/\n');
  await write(`${live}/code.ts`, 'one\ntwo\nthree\nfour\nfive\n');
  await write(`${live}/state/memory/notes.md`, 'n\n');
  await git(live, 'add', '-A');
  await git(live, 'commit', '-qm', 'init');
  await git(live, 'push', '-q', '-u', 'origin', 'main');
  await output(shell, ['git', 'clone', '-q', remote, other], { env: identity });

  const sent: string[] = [];
  const logged: string[] = [];
  const merges: string[] = [];
  const marker = { sha: '' };
  const lock = { held: false };
  const clock = fixedClock('2026-11-09T15:00:00Z');
  const remoteSha = async () => (await git(remote, 'rev-parse', 'main')).trim();

  /** The live checkout as the code under test sees it. */
  const repository = (over: Partial<Repository> = {}): Repository => ({
    git: (args, { cwd } = {}) => raw(cwd ?? live, args),
    remote: 'origin',
    main: 'main',
    hasRemote: async () =>
      (await raw(live, ['remote', 'get-url', '--push', 'origin'])).code === 0,
    dm: async (text) => {
      sent.push(text);
    },
    marker: {
      read: async () => marker.sha || undefined,
      write: async (sha) => {
        marker.sha = sha;
      },
      clear: async () => {
        marker.sha = '';
      },
    },
    hold: async () => {
      if (lock.held) return undefined;
      lock.held = true;
      return {
        release: () => {
          lock.held = false;
        },
      };
    },
    clock,
    log: async (line) => {
      logged.push(line);
    },
    ...over,
  });

  const landDeps = (over: Partial<LandDeps> = {}): LandDeps => ({
    github: {
      repo: 'example/agent',
      pr: async () => ({ number: 7, title: 'Feat', baseRefName: 'main' }),
      merged: async () => true,
    },
    ci: async () => 'green',
    install: async () => undefined,
    manifests: ['package.json', 'bun.lock'],
    scratch: {
      make: async () => (await output(shell, ['mktemp', '-d'])).trim(),
      remove: (path) => disk.remove(path),
    },
    appendMerge: async (row) => {
      merges.push(row);
      await disk.append(`${live}/state/memory/merges.md`, `${row}\n`);
    },
    restart: undefined,
    pollMs: 1,
    ciTimeoutMs: 200,
    lockWaitMs: 1000,
    mergedPollMs: 1,
    mergedTimeoutMs: 10,
    ...over,
  });

  return {
    root,
    live,
    other,
    remote,
    env,
    git,
    raw,
    write,
    read: (path: string) => disk.read(path),
    exists: (path: string) => disk.exists(path),
    sent,
    logged,
    merges,
    marker,
    lock,
    clock,
    repository,
    landDeps,
    remoteSha,
    /** The owner, in their own clone, pushes a change to one file to main; returns the SHA. */
    theirs: async (file: string, text: string): Promise<string> => {
      await git(other, 'pull', '-q', '--rebase', 'origin', 'main');
      await write(`${other}/${file}`, text);
      await git(other, 'add', '-A');
      await git(other, 'commit', '-qm', `theirs: ${file}`);
      await git(other, 'push', '-q', 'origin', 'HEAD:main');
      return (await git(other, 'rev-parse', 'HEAD')).trim();
    },
    /** A worktree with a commit on branch `feat`, as work in a worktree leaves one. */
    feature: async (): Promise<string> => {
      const worktree = `${root}/wt`;
      await git(live, 'worktree', 'add', '-q', '-b', 'feat', worktree, 'main');
      await write(`${worktree}/code.ts`, 'one\ntwo\nthree\nfour\nFIVE\n');
      await git(worktree, 'commit', '-qam', 'feat: change');
      return worktree;
    },
    subjects: (directory: string, ref = 'main') =>
      git(directory, 'log', '--format=%s', ref),
    remove: () => disk.remove(root),
  };
};
