/**
 * The runner in a real Chromium against the lab service on its registered
 * origin. Hostile pages are made by wrapping the lab's own handler, so each
 * negative case still holds a genuine, consumed capability where it can.
 */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mockPlanner, type PlannerInput } from '../src/planner.ts';
import { generateShapesQuiz, seededRandom } from '../src/quiz.ts';
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
  overrides: { capability?: string | undefined; targetUrl?: string } = {}
) => {
  const sessionNonce = crypto.randomUUID();
  const issued = lab.issue(sessionNonce);
  return runChallenge({
    lab,
    planner,
    runId: issued.runId,
    challengeId: issued.challengeId,
    capabilityId: issued.capabilityId,
    capability:
      'capability' in overrides ? overrides.capability : issued.capability,
    sessionNonce,
    targetUrl: overrides.targetUrl ?? LAB_URL,
    executablePath: process.env.LAB_CHROMIUM_PATH,
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
    generateShapesQuiz(seededRandom(seed)).options.findIndex(
      (option) => option.correct
    )
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
    expect(record.gate.map((decision) => decision.allowed)).toEqual([
      true,
      true,
      true,
    ]);
    expect(inputs).toHaveLength(1);
    expect(inputs[0]!.labels).toEqual(LABELS);
    expect(inputs[0]!.prompt).toBe(
      generateShapesQuiz(seededRandom(SEED)).prompt
    );
    expect(lab.stats().submissions).toBe(1);

    // Neither the planner's input nor the record carries the seed or any
    // answer-bearing field; the record holds no option ids at all.
    const plannerText = JSON.stringify({
      prompt: inputs[0]!.prompt,
      labels: inputs[0]!.labels,
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
    const issued = lab.issue(sessionNonce);
    const input = {
      lab,
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
      'a redirect',
      () => async () => Response.redirect(`${LAB_ORIGIN}/lab/elsewhere`, 302),
      {},
      'page_load_failed',
    ],
    [
      'a navigation away',
      (lab) =>
        injecting(lab, `<script>location.href = '/lab/elsewhere';</script>`),
      {},
      // The aborted navigation leaves the main frame on Chromium's error page.
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
