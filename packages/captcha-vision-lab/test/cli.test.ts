/**
 * The lab command's refusals, which happen before any server, browser or
 * provider call.
 */
import { expect, test } from 'bun:test';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
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

test('a mock run reaches the lab directly, never through an operator proxy', async () => {
  let proxied = 0;
  const proxy = Bun.serve({
    hostname: '127.0.0.1',
    port: 47853,
    fetch: () => {
      proxied += 1;
      return new Response('proxy', { status: 502 });
    },
  });
  const records = await mkdtemp(join(tmpdir(), 'captcha-vision-lab-records-'));
  try {
    const result = Bun.spawn(
      ['bun', CLI, '--lab-run', '--challenges', '1', '--records-dir', records],
      {
        env: {
          ...process.env,
          HTTP_PROXY: 'http://127.0.0.1:47853',
          http_proxy: 'http://127.0.0.1:47853',
          NO_PROXY: '',
          no_proxy: '',
        },
        stdout: 'pipe',
      }
    );

    expect(await result.exited).toBe(0);
    expect(await new Response(result.stdout).text()).toMatch(
      /^(solved|incorrect)\tplanner_calls=1\tactions=1/
    );
    expect(await readdir(records)).toHaveLength(1);
    expect(proxied).toBe(0);
  } finally {
    await proxy.stop(true);
    await rm(records, { recursive: true, force: true });
  }
}, 60_000);
