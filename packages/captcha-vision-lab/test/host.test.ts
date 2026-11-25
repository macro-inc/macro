/**
 * The browser host's protocol: it answers only well-formed fixture
 * requests, and ends on anything else.
 */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startBrowserHost } from '../src/browser.ts';
import { hostEnvironment } from '../src/browser-options.ts';
import type { HostReply } from '../src/host-protocol.ts';
import { LAB_URL } from '../src/registry.ts';
import { createLab, type Lab, serveLab } from '../src/server.ts';

const HOST = join(import.meta.dir, '..', 'src', 'browser-host.ts');

/** Runs a host, writes the lines, and returns its exit code and output. */
const runHost = async (lines: string[]) => {
  const env = hostEnvironment();
  const host = Bun.spawn(
    [Bun.which('node', { PATH: env.PATH ?? '' }) ?? 'node', HOST],
    {
      env,
      stdin: 'pipe',
      stdout: 'pipe',
    }
  );
  for (const line of lines) host.stdin.write(`${line}\n`);
  await host.stdin.end();
  return {
    exitCode: await host.exited,
    output: await new Response(host.stdout).text(),
  };
};

test('a well-formed observe is answered', async () => {
  const { exitCode, output } = await runHost(['{"type":"observe"}']);

  expect(exitCode).toBe(0);
  expect(JSON.parse(output)).toEqual({
    type: 'observations',
    observations: {
      mainNavigations: 0,
      redirects: 0,
      popups: 0,
      extraFrames: 0,
      blockedOrigins: [],
      blockedNavigations: 0,
    },
  });
});

const refused: [string, string][] = [
  ['not JSON', 'click at 10,10'],
  ['an unknown message', '{"type":"evaluate","script":"1"}'],
  ['an extra field', '{"type":"observe","url":"http://example.invalid/"}'],
  ['coordinates', '{"type":"act","action":{"kind":"click","x":10,"y":10}}'],
  [
    'an open of any other URL',
    '{"type":"open","targetUrl":"http://127.0.0.1:47831/other","capability":"c","sessionNonce":"n","profile":"/tmp/x"}',
  ],
  ['a capture before open', '{"type":"capture"}'],
  [
    'an action before open',
    '{"type":"act","action":{"kind":"choose","label":"A"},"observations":{"mainNavigations":0,"redirects":0,"popups":0,"extraFrames":0,"blockedOrigins":[],"blockedNavigations":0}}',
  ],
  [
    'a relative browser path',
    '{"type":"open","targetUrl":"http://127.0.0.1:47831/lab/quiz","capability":"c","sessionNonce":"n","profile":"/tmp/x","executablePath":"chromium"}',
  ],
];

for (const [name, line] of refused) {
  test(`${name} ends the host without an answer`, async () => {
    const { exitCode, output } = await runHost([line, '{"type":"observe"}']);

    expect(exitCode).toBe(2);
    expect(output).toBe('');
  });
}

test('a closed stdin ends the host cleanly', async () => {
  const { exitCode, output } = await runHost([]);

  expect(exitCode).toBe(0);
  expect(output).toBe('');
});

test('close is answered, then the host exits', async () => {
  const { exitCode, output } = await runHost([
    '{"type":"close"}',
    '{"type":"observe"}',
  ]);

  expect(exitCode).toBe(0);
  expect(output).toBe('{"type":"closed"}\n');
});

describe('a host with an open page', () => {
  let lab: Lab;
  let server: ReturnType<typeof serveLab>;
  let handler: (request: Request) => Promise<Response>;

  beforeAll(() => {
    server = serveLab((request) => handler(request));
  });

  afterAll(async () => {
    await server.stop(true);
  });

  /** A host that has opened a fresh challenge, and its profile. */
  const openedHost = async () => {
    lab = createLab();
    handler = lab.fetch;
    const sessionNonce = crypto.randomUUID();
    const issued = lab.issue('relation', sessionNonce);
    const profile = await mkdtemp(join(tmpdir(), 'captcha-vision-lab-test-'));
    const host = startBrowserHost();
    if (typeof host === 'string') throw new Error(host);
    const opened = await host.request({
      type: 'open',
      targetUrl: LAB_URL,
      capability: issued.capability,
      sessionNonce,
      profile,
      executablePath: process.env.LAB_CHROMIUM_PATH,
    });
    expect(opened).toMatchObject({ type: 'opened', result: 'ok' });
    const observed = await host.request({ type: 'observe' });
    if (observed.type !== 'observations') throw new Error('no observations');
    const cleanup = async () => {
      await host.stop();
      await rm(profile, { recursive: true, force: true });
    };
    return { host, observations: observed.observations, cleanup };
  };

  const ordinal = (reply: HostReply) => reply.type;

  test('a continuously streaming response exceeds the absolute request deadline', async () => {
    handler = async () => {
      const chunk = new TextEncoder().encode(' ');
      let interval: ReturnType<typeof setInterval>;
      return new Response(
        new ReadableStream({
          start(controller) {
            const started = performance.now();
            controller.enqueue(chunk);
            interval = setInterval(() => {
              if (performance.now() - started >= 12_000) {
                clearInterval(interval);
                controller.close();
              } else {
                controller.enqueue(chunk);
              }
            }, 250);
          },
          cancel() {
            clearInterval(interval);
          },
        }),
        { headers: { 'content-type': 'text/html' } }
      );
    };
    const profile = await mkdtemp(join(tmpdir(), 'captcha-vision-lab-test-'));
    const host = startBrowserHost();
    try {
      if (typeof host === 'string') throw new Error(host);
      const opened = await host.request({
        type: 'open',
        targetUrl: LAB_URL,
        capability: 'c',
        sessionNonce: 'n',
        profile,
        executablePath: process.env.LAB_CHROMIUM_PATH,
      });
      expect(opened).toMatchObject({ type: 'opened', result: 'load_failed' });
    } finally {
      if (typeof host !== 'string') await host.stop();
      await rm(profile, { recursive: true, force: true });
    }
  }, 30_000);

  test('a second open ends the host', async () => {
    const { host, cleanup } = await openedHost();
    try {
      await expect(
        host.request({
          type: 'open',
          targetUrl: LAB_URL,
          capability: 'c',
          sessionNonce: 'n',
          profile: '/tmp/x',
        })
      ).rejects.toThrow('browser host ended');
      expect(await host.exited).toBe(2);
    } finally {
      await cleanup();
    }
  }, 60_000);

  test('an action on changed observations is refused, and a second action ends the host', async () => {
    const { host, observations, cleanup } = await openedHost();
    try {
      const refused = await host.request({
        type: 'act',
        action: { kind: 'choose', label: 'A' },
        observations: { ...observations, popups: observations.popups + 1 },
      });
      expect(ordinal(refused)).toBe('acted');
      expect(refused).toMatchObject({ result: 'observations_changed' });
      expect(lab.stats().submissions).toBe(0);

      await expect(
        host.request({
          type: 'act',
          action: { kind: 'choose', label: 'A' },
          observations,
        })
      ).rejects.toThrow('browser host ended');
      expect(await host.exited).toBe(2);
      expect(lab.stats().submissions).toBe(0);
    } finally {
      await cleanup();
    }
  }, 60_000);
});
