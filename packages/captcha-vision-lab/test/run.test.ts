/**
 * The runner in a real Chromium against the lab service on its registered
 * origin. Hostile pages are made by wrapping the lab's own handler, so each
 * negative case still holds a genuine, consumed capability where it can.
 */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { relation } from '../src/families.ts';
import { mockPlanner, type PlannerInput } from '../src/planner.ts';
import { seededRandom } from '../src/random.ts';
import { LAB_ORIGIN, LAB_PATH, LAB_URL } from '../src/registry.ts';
import { runChallenge } from '../src/run.ts';
import { createLab, type Lab, serveLab } from '../src/server.ts';

const SEED = 918273645;
const LABELS = ['A', 'B', 'C', 'D'];

type Handler = (request: Request) => Promise<Response>;

let handler: Handler = async () => new Response('unset', { status: 500 });
let server: ReturnType<typeof serveLab>;

beforeAll(() => {
  server = serveLab((request) => handler(request));
});

afterAll(async () => {
  await server.stop(true);
});

/** A mock planner that keeps every input it is given. */
const recordingPlanner = (label: string) => {
  const inputs: PlannerInput[] = [];
  const planner = mockPlanner((input) => {
    inputs.push(input);
    return { kind: 'choice', label };
  });
  return { planner, inputs };
};

const run = (
  lab: Lab,
  planner: ReturnType<typeof mockPlanner>,
  overrides: { capability?: string | undefined; targetUrl?: string } = {},
  deadlineMs?: number
) => {
  const sessionNonce = crypto.randomUUID();
  const issued = lab.issue('relation', sessionNonce);
  return runChallenge({
    lab,
    family: 'relation',
    planner,
    runId: issued.runId,
    challengeId: issued.challengeId,
    capabilityId: issued.capabilityId,
    capability:
      'capability' in overrides ? overrides.capability : issued.capability,
    sessionNonce,
    targetUrl: overrides.targetUrl ?? LAB_URL,
    executablePath: process.env.LAB_CHROMIUM_PATH,
    deadlineMs,
  });
};

/** Serves the lab, but adds `extra` to the quiz page and drops its CSP. */
const injecting =
  (lab: Lab, extra: string): Handler =>
  async (request) => {
    const response = await lab.fetch(request);
    if (new URL(request.url).pathname !== LAB_PATH || response.status !== 200) {
      return response;
    }
    const html = (await response.text()).replace('</body>', `${extra}</body>`);
    return new Response(html, { headers: { 'content-type': 'text/html' } });
  };

const correctLabel = (seed: number): string =>
  LABELS[
    relation(seededRandom(seed)).options.findIndex((option) => option.correct)
  ]!;

describe('a lab run with the mock planner', () => {
  test('the right choice is solved by the server', async () => {
    const lab = createLab({ random: seededRandom(SEED) });
    handler = lab.fetch;
    const { planner, inputs } = recordingPlanner(correctLabel(SEED));

    const record = await run(lab, planner);

    expect(record.outcome).toBe('solved');
    expect(record.plannerCalls).toBe(1);
    expect(record.actions).toEqual([
      { kind: 'choose', label: correctLabel(SEED) },
    ]);
    expect(record.gate.map((decision) => decision.stage)).toEqual([
      'before_navigation',
      'before_planner',
      'before_planner',
      'before_action',
      'after_action',
    ]);
    expect(record.gate.every((decision) => decision.allowed)).toBe(true);
    expect(inputs).toHaveLength(1);
    expect(inputs[0]!.response).toEqual({ kind: 'choice', labels: LABELS });
    expect(inputs[0]!.prompt).toBe(relation(seededRandom(SEED)).prompt);
    expect(lab.stats().submissions).toBe(1);

    // Neither the planner's input nor the record carries the seed or any
    // answer-bearing field; the record holds no option ids at all.
    const plannerText = JSON.stringify({
      prompt: inputs[0]!.prompt,
      response: inputs[0]!.response,
    });
    const recordText = JSON.stringify(record);
    for (const text of [plannerText, recordText]) {
      expect(text).not.toContain(String(SEED));
      expect(text.toLowerCase()).not.toMatch(
        /correct|answer|seed|data-lab-option/
      );
    }
  });

  test('a wrong choice is scored incorrect', async () => {
    const lab = createLab({ random: seededRandom(SEED) });
    handler = lab.fetch;
    const wrong = LABELS.find((label) => label !== correctLabel(SEED))!;

    const record = await run(lab, recordingPlanner(wrong).planner);

    expect(record.outcome).toBe('incorrect');
    expect(record.actions).toHaveLength(1);
  });

  test('a replayed capability is rejected before the planner', async () => {
    const lab = createLab();
    handler = lab.fetch;
    const sessionNonce = crypto.randomUUID();
    const issued = lab.issue('relation', sessionNonce);
    const input = {
      lab,
      family: 'relation' as const,
      runId: issued.runId,
      challengeId: issued.challengeId,
      capabilityId: issued.capabilityId,
      capability: issued.capability,
      sessionNonce,
      targetUrl: LAB_URL,
      executablePath: process.env.LAB_CHROMIUM_PATH,
    };
    const first = recordingPlanner('A');
    const second = recordingPlanner('A');

    expect(
      (await runChallenge({ ...input, planner: first.planner })).plannerCalls
    ).toBe(1);
    const replay = await runChallenge({ ...input, planner: second.planner });

    expect(replay.outcome).toBe('provenance_rejected');
    expect(replay.plannerCalls).toBe(0);
    expect(replay.actions).toHaveLength(0);
    expect(second.inputs).toHaveLength(0);
    expect(lab.stats().submissions).toBe(1);
  });
});

describe('the provenance gate fails closed', () => {
  const cases: [
    string,
    (lab: Lab) => Handler,
    { capability?: string | undefined; targetUrl?: string },
    string,
  ][] = [
    [
      'no capability',
      (lab) => lab.fetch,
      { capability: undefined },
      'missing_capability',
    ],
    [
      'a forged capability',
      (lab) => lab.fetch,
      { capability: 'e30.AAAA' },
      'page_load_failed',
    ],
    [
      'a wrong origin',
      (lab) => lab.fetch,
      { targetUrl: LAB_URL.replace('127.0.0.1', 'localhost') },
      'unregistered_url',
    ],
    [
      'a wrong path',
      (lab) => lab.fetch,
      { targetUrl: `${LAB_ORIGIN}/lab/other` },
      'unregistered_url',
    ],
    [
      // Even back to the registered URL itself.
      'a redirect',
      () => async () => Response.redirect(LAB_URL, 302),
      {},
      'redirect',
    ],
    [
      'a navigation away',
      (lab) =>
        injecting(lab, `<script>location.href = '/lab/elsewhere';</script>`),
      {},
      'blocked_navigation',
    ],
    [
      'a navigation to about:blank',
      (lab) =>
        injecting(
          lab,
          `<script>setTimeout(() => { location.href = 'about:blank'; }, 100);</script>`
        ),
      {},
      'main_frame_url',
    ],
    [
      'a popup',
      (lab) =>
        injecting(
          lab,
          `<script>window.open('${LAB_ORIGIN}/lab/popup');</script>`
        ),
      {},
      'popup',
    ],
    [
      'a third-party frame',
      (lab) =>
        injecting(lab, `<iframe src="http://127.0.0.2:47832/frame"></iframe>`),
      {},
      'extra_frame',
    ],
    [
      'a popup opened later',
      (lab) =>
        injecting(
          lab,
          `<script>setTimeout(() => window.open('${LAB_ORIGIN}/lab/popup'), 200);</script>`
        ),
      {},
      'popup',
    ],
    [
      'a WebSocket',
      (lab) =>
        injecting(
          lab,
          `<script>new WebSocket('ws://127.0.0.2:47832/x');</script>`
        ),
      {},
      'non_lab_request',
    ],
    [
      'a third-party asset',
      (lab) => injecting(lab, `<img src="http://127.0.0.2:47832/pixel.png">`),
      {},
      'non_lab_request',
    ],
  ];

  for (const [name, makeHandler, overrides, reason] of cases) {
    test(`${name}: zero planner calls and zero actions`, async () => {
      const lab = createLab();
      handler = makeHandler(lab);
      const { planner, inputs } = recordingPlanner('A');

      const record = await run(lab, planner, overrides);

      expect(record.outcome).toBe('provenance_rejected');
      expect(record.gate.at(-1)).toMatchObject({ allowed: false, reason });
      expect(record.plannerCalls).toBe(0);
      expect(record.actions).toHaveLength(0);
      expect(inputs).toHaveLength(0);
      expect(lab.stats().submissions).toBe(0);
    });
  }

  test('an expired capability: zero planner calls and zero actions', async () => {
    let now = 1_000_000;
    const lab = createLab({ now: () => now });
    handler = lab.fetch;
    const sessionNonce = crypto.randomUUID();
    const issued = lab.issue('relation', sessionNonce);
    const { planner, inputs } = recordingPlanner('A');
    now += 30_001;

    const record = await runChallenge({
      lab,
      family: 'relation',
      planner,
      ...issued,
      sessionNonce,
      targetUrl: LAB_URL,
      executablePath: process.env.LAB_CHROMIUM_PATH,
    });

    expect(record.outcome).toBe('provenance_rejected');
    expect(record.detail).toStartWith('page_load_failed');
    expect(record.plannerCalls).toBe(0);
    expect(inputs).toHaveLength(0);
    expect(lab.stats().submissions).toBe(0);
  });

  test("another run's capability: zero planner calls and zero actions", async () => {
    const lab = createLab();
    handler = lab.fetch;
    const other = lab.issue('relation', crypto.randomUUID());
    const { planner, inputs } = recordingPlanner('A');

    const record = await run(lab, planner, { capability: other.capability });

    expect(record.outcome).toBe('provenance_rejected');
    expect(record.detail).toStartWith('page_load_failed');
    expect(record.plannerCalls).toBe(0);
    expect(inputs).toHaveLength(0);
    expect(lab.stats().pageLoads).toBe(0);
  });

  const afterClick: [string, string, string][] = [
    ['a popup', `window.open('${LAB_ORIGIN}/lab/popup')`, 'popup'],
    [
      'a third-party request',
      `fetch('http://127.0.0.2:47832/beacon').catch(() => {})`,
      'non_lab_request',
    ],
  ];

  for (const [name, script, reason] of afterClick) {
    test(`${name} set off by the click voids the scored attempt`, async () => {
      const lab = createLab();
      handler = injecting(
        lab,
        `<script>for (const button of document.querySelectorAll('[data-lab-option]')) button.addEventListener('click', () => ${script});</script>`
      );

      const record = await run(lab, recordingPlanner('A').planner);

      expect(record.outcome).toBe('provenance_rejected');
      expect(record.gate.at(-1)).toMatchObject({
        stage: 'after_action',
        allowed: false,
        reason,
      });
      expect(record.actions).toHaveLength(1);
    });
  }

  test('a failed click records no page markup', async () => {
    const lab = createLab();
    // A layer over the quiz swallows the click until it times out.
    handler = injecting(
      lab,
      '<div style="position: fixed; inset: 0; z-index: 10"></div>'
    );

    const record = await run(lab, recordingPlanner('A').planner);

    expect(record.outcome).toBe('action_error');
    expect(record.detail).toBe('TimeoutError');
    expect(JSON.stringify(record)).not.toMatch(/data-lab-option|<button/);
    expect(lab.stats().submissions).toBe(0);
  }, 20_000);

  test('the gate is checked again before the action', async () => {
    let now = 1_000_000;
    const lab = createLab({ now: () => now });
    handler = lab.fetch;
    // The challenge expires while the planner is thinking.
    const planner = mockPlanner(() => {
      now += 120_001;
      return { kind: 'choice', label: 'A' };
    });

    const record = await run(lab, planner);

    expect(record.outcome).toBe('provenance_rejected');
    expect(record.gate.at(-1)).toMatchObject({
      stage: 'before_action',
      allowed: false,
      reason: 'challenge_not_pending',
    });
    expect(record.plannerCalls).toBe(1);
    expect(record.actions).toHaveLength(0);
    expect(lab.stats().submissions).toBe(0);
  });
});

describe('the per-challenge deadline', () => {
  test('a planner that never answers ends in a kept timeout, no action', async () => {
    const lab = createLab();
    handler = lab.fetch;
    let plannerSignal: AbortSignal | undefined;
    const planner = {
      provider: 'mock' as const,
      model: 'mock',
      plan: (_input: PlannerInput, signal: AbortSignal) => {
        plannerSignal = signal;
        return new Promise<never>(() => {});
      },
    };
    const sessionNonce = crypto.randomUUID();
    const issued = lab.issue('relation', sessionNonce);

    const record = await runChallenge({
      lab,
      planner,
      family: 'relation',
      ...issued,
      sessionNonce,
      targetUrl: LAB_URL,
      executablePath: process.env.LAB_CHROMIUM_PATH,
      deadlineMs: 3_000,
    });

    expect(record.outcome).toBe('timeout');
    expect(record.detail).toBe('challenge_deadline');
    expect(record.plannerCalls).toBe(1);
    expect(record.actions).toHaveLength(0);
    expect(record.timings.totalMs).toBeGreaterThanOrEqual(3_000);
    expect(plannerSignal?.aborted).toBe(true);
    expect(lab.stats().submissions).toBe(0);
  }, 30_000);

  test('a page that never loads ends in a kept timeout, no planner call', async () => {
    const lab = createLab();
    handler = async (request) => {
      if (new URL(request.url).pathname === LAB_PATH) {
        return new Promise<Response>(() => {});
      }
      return lab.fetch(request);
    };
    const { planner, inputs } = recordingPlanner('A');

    const record = await run(lab, planner, {}, 3_000);

    expect(record.outcome).toBe('timeout');
    expect(record.plannerCalls).toBe(0);
    expect(inputs).toHaveLength(0);
    expect(record.actions).toHaveLength(0);
    // The record is final, and no Chromium of the attempt outlives it.
    expect(Object.isFrozen(record)).toBe(true);
    expect(Object.isFrozen(record.actions)).toBe(true);
    const left = Bun.spawnSync([
      'pgrep',
      '-f',
      `--user-data-dir=${join(tmpdir(), 'captcha-vision-lab-')}`,
    ]);
    expect(left.stdout.toString()).toBe('');
  }, 60_000);
});

test('a browser that cannot start is a kept browser_error, no planner call', async () => {
  const lab = createLab();
  handler = lab.fetch;
  const { planner, inputs } = recordingPlanner('A');
  const sessionNonce = crypto.randomUUID();
  const issued = lab.issue('relation', sessionNonce);

  const record = await runChallenge({
    lab,
    planner,
    family: 'relation',
    ...issued,
    sessionNonce,
    targetUrl: LAB_URL,
    executablePath: '/nonexistent/chromium',
  });

  expect(record.outcome).toBe('browser_error');
  expect(record.detail).toBe('browser_launch_failed');
  expect(record.plannerCalls).toBe(0);
  expect(record.actions).toHaveLength(0);
  expect(inputs).toHaveLength(0);
  expect(lab.stats().submissions).toBe(0);
});

test('Node older than 22.18 is rejected before starting the host', async () => {
  const bin = await mkdtemp(join(tmpdir(), 'captcha-vision-node-test-'));
  const node = join(bin, 'node');
  const hostStarted = `${node}.started`;
  const previousPath = process.env.PATH;
  const lab = createLab();
  handler = lab.fetch;
  const { planner, inputs } = recordingPlanner('A');

  try {
    await writeFile(
      node,
      '#!/bin/sh\n' +
        'if [ "$1" = "--version" ]; then printf "v22.17.1\\n"; exit 0; fi\n' +
        ': > "$0.started"\n' +
        'exit 1\n'
    );
    await chmod(node, 0o755);
    process.env.PATH = `${bin}:${previousPath ?? ''}`;

    const record = await run(lab, planner);

    expect(record.outcome).toBe('browser_error');
    expect(record.detail).toBe('browser_launch_failed');
    expect(inputs).toHaveLength(0);
    expect(await Bun.file(hostStarted).exists()).toBe(false);
  } finally {
    if (previousPath === undefined) delete process.env.PATH;
    else process.env.PATH = previousPath;
    await rm(bin, { recursive: true, force: true });
  }
});
