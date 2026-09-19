import { expect, test } from 'bun:test';
import type { CommandRunner } from './interfaces';
import {
  assertSafeRepoUrl,
  ENSURE_TIMEOUT_S,
  ensureReady,
  ensureReadyCommand,
} from './provision';

test('accepts a plain https repo url', () => {
  expect(() =>
    assertSafeRepoUrl('https://github.com/macro-inc/macro.git')
  ).not.toThrow();
});

test.each([
  ['not a url', 'nonsense'],
  ['non-https', 'http://github.com/macro-inc/macro.git'],
  ['shell metacharacters', 'https://github.com/macro-inc/macro.git;rm -rf /'],
  ['command substitution', 'https://github.com/$(whoami)/macro.git'],
])('rejects %s', (_label, url) => {
  expect(() => assertSafeRepoUrl(url)).toThrow();
});

test('every stage guards itself so the script is idempotent', () => {
  const cmd = ensureReadyCommand();
  expect(cmd).toContain('if [ ! -d /workspace/.git ]');
  expect(cmd).toContain('if ! curl -sf localhost:8700/ping');
});

test('secrets come from the environment, not interpolation', () => {
  const cmd = ensureReadyCommand();
  expect(cmd).toContain('clone --depth 1 "$REPO_URL"');
  expect(cmd).toContain('gh auth setup-git --hostname github.com --force');
  expect(cmd).not.toContain('GITHUB_TOKEN');
  expect(cmd).not.toContain('http.extraHeader');
});

test('sidecar starts detached sourcing the baked repo env when present', () => {
  const cmd = ensureReadyCommand();
  expect(cmd).toContain('if [ -f /env/repo-dev-env.sh ]');
  expect(cmd).toContain('baked_path="$PATH"');
  expect(cmd).toContain('export PATH="$PATH:$baked_path"');
  expect(cmd).toContain('nohup /opt/acp-sidecar');
});

test('ensureReady runs the script with the ensure timeout', async () => {
  const calls: { command: string; timeoutS?: number }[] = [];
  const runner: CommandRunner = {
    async run(command, opts) {
      calls.push({ command, timeoutS: opts?.timeoutS });
    },
  };
  await ensureReady(runner);
  expect(calls).toEqual([
    { command: ensureReadyCommand(), timeoutS: ENSURE_TIMEOUT_S },
  ]);
});
