/**
 * The whole chain on a real Chromium and a real OpenCode: solveCaptcha →
 * OpenCode (its model a scripted stand-in behind the relay's Fireworks
 * route) → the captcha MCP server → the relay → a stand-in harness → the
 * page. Runs when `chromium` and `opencode` are on PATH.
 */
import { afterAll, beforeAll, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium, type Running } from '@macro-inc/muppet/utilities/browser';
import { passthrough } from '../../../agent/claude.ts';
import { shell } from '../../../context/index.ts';
import { startRelay } from '../../../context/relay.ts';
import { driverPorts } from '../../browser/driver.ts';
import { solveCaptcha } from '../index.ts';
import { withCurrentPage } from '../page.ts';
import { standInRunId, startFixture } from './fixture.ts';

const available =
  Bun.which('chromium') !== null && Bun.which('opencode') !== null;
const port = 9439;
const endpoint = `http://127.0.0.1:${port}`;
const token = 'XXXX.DUMMY.TOKEN.XXXX';

let directory = '';
let running: Running | undefined;
const toolsOffered: string[][] = [];
const fixture = startFixture({
  solve: () => ({
    outcome: 'solved',
    token,
    userAgent: null,
    taskId: 'task-1',
  }),
  // The stand-in model: solve once, then say what came back.
  chat: ({ messages, tools }) => {
    toolsOffered.push((tools ?? []).map((tool) => tool.function.name));
    return messages.some((message) => message.role === 'tool')
      ? { text: 'solved' }
      : { tool: 'captcha_solve_captcha' };
  },
});
const relay = startRelay({
  targets: {},
  speech: `${fixture.origin}/brain/inference`,
  brain: `${fixture.origin}/brain`,
  apiKey: 'agent-macro-key',
});

beforeAll(async () => {
  if (!available) return;
  directory = await mkdtemp(join(tmpdir(), 'captcha-opencode-'));
  running = await chromium({ profile: join(directory, 'profile'), port });
});

afterAll(async () => {
  relay.stop();
  fixture.stop();
  await running?.stop();
  if (directory !== '') await rm(directory, { recursive: true, force: true });
});

test.skipIf(!available)(
  "solves through OpenCode with only the captcha tools, the agent's key added by the relay",
  async () => {
    await withCurrentPage(endpoint, async (page) => {
      await page.goto(`${fixture.origin}/turnstile`);
    });
    const driving = driverPorts({
      advisory: join(directory, 'screen-driver'),
      lease: join(directory, 'run', 'solver-lease.json'),
      now: () => Date.now(),
    });
    const answer = await solveCaptcha(
      {
        captcha: {
          config: {
            runs: join(directory, 'runs'),
            harnessIdFile: join(directory, 'harness-id'),
            server: join(import.meta.dir, '..', 'mcp.ts'),
            runLimitMs: 120_000,
          },
          browserEndpoint: endpoint,
          screenDriver: join(directory, 'screen-driver'),
          withPage: (use) => withCurrentPage(endpoint, use),
          driving,
          fetch: (request) => fetch(request),
        },
        config: { me: 'agent-1@example.invalid' },
        shell,
        sandbox: [],
        join,
        relay: () => Promise.resolve({ url: relay.url, token: relay.token }),
        macro: () =>
          Promise.reject(new Error('no screen link is needed when solved')),
        trace: passthrough,
      },
      { reason: 'signing in to the shop' }
    );

    expect(answer).toEqual({
      outcome: 'solved',
      evidence: 'challengeGone',
      next: 'Cleared. Carry on with the page.',
    });
    const runs = fixture.seen.filter(
      ({ path }) => path === '/brain/captcha/runs'
    );
    expect(runs.length).toBe(1);
    expect(
      fixture.seen.filter(
        ({ path }) => path === `/brain/captcha/runs/${standInRunId}/end`
      ).length
    ).toBe(1);
    const solves = fixture.seen.filter(
      ({ path }) => path === '/brain/captcha/solve'
    );
    expect(solves.map(({ run }) => run)).toEqual([standInRunId]);
    expect(solves.map(({ authorization }) => authorization)).toEqual([
      'Bearer agent-macro-key',
    ]);
    const chats = fixture.seen.filter(
      ({ path }) => path === '/brain/fireworks/v1/chat/completions'
    );
    expect(chats.length).toBe(2);
    expect(chats.map(({ run }) => run)).toEqual([standInRunId, standInRunId]);
    expect(new Set(chats.map(({ authorization }) => authorization))).toEqual(
      new Set(['Bearer agent-macro-key'])
    );
    expect(new Set(toolsOffered.flat())).toEqual(
      new Set(['captcha_detect_captcha', 'captcha_solve_captcha'])
    );
    expect(await driving.driver()).toEqual({ kind: 'agent' });
  },
  120_000
);
