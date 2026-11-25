/**
 * solveCaptcha around the solver run, with a stand-in run: what it answers
 * when the run ends without recording an attempt.
 */
import { afterAll, afterEach, expect, test } from 'bun:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { passthrough } from '../../../agent/claude.ts';
import type { Shell } from '../../../context/shell.ts';
import { driverPorts } from '../../browser/driver.ts';
import { solveCaptcha } from '../index.ts';
import { recaptchaTestKey, standInRunId, startFixture } from './fixture.ts';

const fixture = startFixture({
  solve: () => ({
    outcome: 'solved',
    token: 'unused',
    userAgent: null,
    taskId: 'task-1',
  }),
});
const directories: string[] = [];

afterEach(async () => {
  for (const directory of directories.splice(0))
    await rm(directory, { recursive: true, force: true });
});
afterAll(() => fixture.stop());

/** Runs solveCaptcha on a found reCAPTCHA, the solver run being `during` and then a timed-out exit. */
const solveWith = async (during: (advisory: string) => Promise<void>) => {
  const directory = await mkdtemp(join(tmpdir(), 'captcha-run-'));
  directories.push(directory);
  const advisory = join(directory, 'screen-driver');
  const driving = driverPorts({
    advisory,
    lease: join(directory, 'run', 'solver-lease.json'),
    now: () => Date.now(),
  });
  const shell: Shell = {
    run: async () => {
      await during(advisory);
      return { code: 124, stdout: '', stderr: '' };
    },
    start: () => {
      throw new Error('the solver run is never started in the background');
    },
    alive: () => false,
  };
  const answer = await solveCaptcha(
    {
      captcha: {
        config: {
          runs: join(directory, 'runs'),
          harnessIdFile: join(directory, 'harness-id'),
          server: join(import.meta.dir, '..', 'mcp.ts'),
          runLimitMs: 1_000,
        },
        browserEndpoint: 'http://127.0.0.1:1',
        screenDriver: advisory,
        withPage: <Value>() =>
          Promise.resolve({
            targetId: 'tab-1',
            url: `${fixture.origin}/recaptcha`,
            pageUrl: `${fixture.origin}/recaptcha`,
            challenge: {
              kind: 'recaptchaV2',
              siteKey: recaptchaTestKey,
              invisible: false,
              enterprise: false,
            },
          } as Value),
        driving,
        fetch: (request) => fetch(request),
      },
      config: { me: 'agent-1@example.invalid' },
      shell,
      sandbox: [],
      join,
      relay: () =>
        Promise.resolve({ url: fixture.origin, token: 'relay-capability' }),
      macro: () => Promise.reject(new Error('no web app in this test')),
      trace: passthrough,
    },
    { reason: 'signing in to the shop' }
  );
  return { answer, driving };
};

test('a run the owner cut short by taking the screen answers ownerDriving', async () => {
  const { answer, driving } = await solveWith((advisory) =>
    writeFile(advisory, 'human')
  );
  expect(answer).toEqual({
    outcome: 'ownerDriving',
    next: 'Your owner is driving your screen. Wait until they hand it back.',
  });
  expect(
    fixture.seen.filter(
      ({ path }) => path === `/brain/captcha/runs/${standInRunId}/end`
    ).length
  ).toBeGreaterThan(0);
  expect(await driving.driver()).toEqual({ kind: 'owner' });
});

test('a run that ends with no attempt while the agent drives is a solver failure', async () => {
  const { answer } = await solveWith(() => Promise.resolve());
  expect(answer).toEqual({
    outcome: 'solverFailed',
    exitCode: 124,
    next: 'Ask your owner to clear it on your screen (send them the screen link if there is one), or find another way: an API, an integration, or a login they grant you.',
  });
});
