/**
 * The lab command's refusals, which happen before any server, browser or
 * provider call.
 */
import { expect, test } from 'bun:test';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LAB_HOST, LAB_PORT } from '../src/registry.ts';

const CLI = join(import.meta.dir, '..', 'src', 'cli.ts');
const cliEnv = Object.fromEntries(
  Object.entries(process.env).filter(
    ([name]) => !/^(?:https?|all|no)_proxy$/i.test(name)
  )
);

const runCli = (args: string[]) =>
  Bun.spawnSync(['bun', CLI, ...args], {
    env: { ...cliEnv, FIREWORK_API_KEY: 'test-key-never-sent' },
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

test('refuses proxy-configured runs before making any requests', async () => {
  let labRequests = 0;
  const lab = Bun.serve({
    hostname: LAB_HOST,
    port: LAB_PORT,
    fetch: () => {
      labRequests += 1;
      return new Response(null, { status: 500 });
    },
  });
  let proxied = 0;
  const proxy = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    fetch: () => {
      proxied += 1;
      return new Response('proxy', { status: 502 });
    },
  });
  const records = await mkdtemp(join(tmpdir(), 'captcha-vision-lab-records-'));
  try {
    const variants = [
      ['HTTP_PROXY', proxy.url.origin],
      ['HTTPS_PROXY', proxy.url.origin],
      ['ALL_PROXY', proxy.url.origin],
      ['http_proxy', proxy.url.origin],
      ['https_proxy', proxy.url.origin],
      ['all_proxy', proxy.url.origin],
      ['Http_Proxy', proxy.url.origin],
      ['HTTP_PROXY', proxy.url.origin, '127.0.0.1'],
      ['HTTP_PROXY', '', '127.0.0.1'],
    ] as const;
    for (const [name, value, bypass] of variants) {
      const result = Bun.spawn(
        [
          'bun',
          CLI,
          '--lab-run',
          '--provider',
          'kimi',
          '--kimi-base-url',
          proxy.url.origin,
          '--records-dir',
          join(records, 'run'),
        ],
        {
          env: {
            ...cliEnv,
            [name]: value,
            NO_PROXY: bypass,
            no_proxy: bypass,
          },
          stderr: 'pipe',
        }
      );
      expect(await result.exited).toBe(2);
      expect(await new Response(result.stderr).text()).toBe(
        `refusing to run: unset proxy variables (${name})\n`
      );
    }
    expect(await readdir(records)).toHaveLength(0);
    expect(labRequests).toBe(0);
    expect(proxied).toBe(0);
  } finally {
    await lab.stop(true);
    await proxy.stop(true);
    await rm(records, { recursive: true, force: true });
  }
}, 60_000);
