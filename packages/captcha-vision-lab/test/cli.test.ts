/**
 * The lab command's refusals, which happen before any server, browser or
 * provider call.
 */
import { expect, test } from 'bun:test';
import { join } from 'node:path';

const CLI = join(import.meta.dir, '..', 'src', 'cli.ts');

const runCli = (args: string[]) =>
  Bun.spawnSync(['bun', CLI, ...args], {
    env: { ...process.env, FIREWORK_API_KEY: 'test-key-never-sent' },
  });

test('without --lab-run nothing runs', () => {
  const result = runCli([]);

  expect(result.exitCode).toBe(2);
  expect(result.stderr.toString()).toContain('pass --lab-run');
});

test('a remote provider needs --allow-remote-provider', () => {
  const result = runCli(['--lab-run', '--provider', 'kimi']);

  expect(result.exitCode).toBe(2);
  expect(result.stderr.toString()).toContain('--allow-remote-provider');
});

test('the key goes to Fireworks or nowhere', () => {
  const result = runCli([
    '--lab-run',
    '--provider',
    'kimi',
    '--allow-remote-provider',
    '--kimi-base-url',
    'https://api.fireworks.ai.example.invalid/inference/v1',
  ]);

  expect(result.exitCode).toBe(2);
  expect(result.stderr.toString()).toContain(
    'a remote --kimi-base-url must be https://api.fireworks.ai/inference/v1'
  );
});
