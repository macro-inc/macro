// How the agent feels about people and what they told it stays out of git: history
// can't be purged from a repository.
import { expect, test } from 'bun:test';
import { join } from 'node:path';
import { state } from '../../../context/state.ts';
import { owner } from '../config.ts';

/** The records' directory, relative to the repository's root. */
const directory = state({ root: '', join }).private(owner);
/** The agent's own directory, which the state paths are relative to: also right when it sits inside a larger repository. */
const root = join(import.meta.dir, '..', '..', '..', '..');

const git = (...args: readonly string[]) =>
  Bun.spawnSync(['git', ...args], { cwd: root });

test('nothing under the people directory is tracked', () => {
  const listed = git('ls-files', directory);
  expect(listed.exitCode).toBe(0);
  expect(listed.stdout.toString()).toBe('');
});

test('anything written there is ignored, so no commit can ever add it', () => {
  expect(directory).toBe('state/private/people');
  for (const name of [
    'macro%7Cada%40example.com.json',
    'pending/x.jsonl',
    '.lock',
  ])
    expect(
      git('check-ignore', '-q', '--no-index', join(directory, name)).exitCode
    ).toBe(0);
});
