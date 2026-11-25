/**
 * Every family: deterministic seeds, server scoring, leakage, the runner end
 * to end with the mock planner, the executor's bounds, and the gate.
 */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import {
  FAMILIES,
  FAMILY_NAMES,
  type FamilyName,
  TEXT_PATTERN,
} from '../src/families.ts';
import { mockPlanner, type PlannerDecision } from '../src/planner.ts';
import { seededRandom } from '../src/random.ts';
import {
  CAPABILITY_HEADER,
  LAB_ORIGIN,
  LAB_PATH,
  LAB_SUBMIT_PATH,
  LAB_URL,
  SESSION_HEADER,
} from '../src/registry.ts';
import { runChallenge } from '../src/run.ts';
import { createLab, type Lab, serveLab } from '../src/server.ts';

const SEED = 918273645;

type Handler = (request: Request) => Promise<Response>;
let handler: Handler = async () => new Response('unset', { status: 500 });
let server: ReturnType<typeof serveLab>;

beforeAll(() => {
  server = serveLab((request) => handler(request));
});

afterAll(async () => {
  await server.stop(true);
});

/** The right response for a seed, read from the same generator. */
const rightDecision = (family: FamilyName, seed: number): PlannerDecision => {
  const challenge = FAMILIES[family].generate(seededRandom(seed));
  if (challenge.kind === 'text') {
    return { kind: 'text', text: challenge.text };
  }
  if (challenge.kind === 'order') {
    const labels = [...challenge.options]
      .sort((first, second) => first.rank - second.rank)
      .map((option) => option.label);
    return { kind: 'order', labels };
  }
  const right = challenge.options.find((option) => option.correct)!;
  return { kind: 'choice', label: right.label };
};

/** A well-formed but wrong response for a seed. */
const wrongDecision = (family: FamilyName, seed: number): PlannerDecision => {
  const right = rightDecision(family, seed);
  if (right.kind === 'text') {
    const flipped = right.text[0] === '0' ? '1' : '0';
    return { kind: 'text', text: `${flipped}${right.text.slice(1)}` };
  }
  if (right.kind === 'order') {
    return { kind: 'order', labels: [...right.labels].reverse() };
  }
  if (right.kind === 'choice') {
    const challenge = FAMILIES[family].generate(seededRandom(seed));
    const labels =
      challenge.kind === 'choice'
        ? challenge.options.map((option) => option.label)
        : [];
    return {
      kind: 'choice',
      label: labels.find((label) => label !== right.label)!,
    };
  }
  return right;
};

const run = (
  lab: Lab,
  family: FamilyName,
  decide: () => PlannerDecision,
  capability?: string
) => {
  const sessionNonce = crypto.randomUUID();
  const issued = lab.issue(family, sessionNonce);
  let calls = 0;
  const planner = mockPlanner(() => {
    calls += 1;
    return decide();
  });
  const record = runChallenge({
    lab,
    planner,
    family,
    ...issued,
    capability: capability ?? issued.capability,
    sessionNonce,
    targetUrl: LAB_URL,
    executablePath: process.env.LAB_CHROMIUM_PATH,
  });
  return { record, calls: () => calls };
};

for (const family of FAMILY_NAMES) {
  describe(family, () => {
    test('a seed reproduces the challenge', () => {
      const first = FAMILIES[family].generate(seededRandom(SEED));
      const second = FAMILIES[family].generate(seededRandom(SEED));

      expect(second).toEqual(first);
      expect(first.kind).toBe(FAMILIES[family].kind);
      if (first.kind === 'choice') {
        expect(first.options.filter((option) => option.correct)).toHaveLength(
          1
        );
      }
      if (first.kind === 'order') {
        expect(first.options.map((option) => option.rank).sort()).toEqual([
          0, 1, 2, 3,
        ]);
      }
      if (first.kind === 'text') {
        expect(first.text).toMatch(TEXT_PATTERN);
      }
    });

    test('nothing the browser receives identifies the right response', async () => {
      const lab = createLab({ random: seededRandom(SEED) });
      const issued = lab.issue(family, 'session-1');
      const page = await lab.fetch(
        new Request(LAB_URL, {
          headers: {
            [CAPABILITY_HEADER]: issued.capability,
            [SESSION_HEADER]: 'session-1',
          },
        })
      );
      const html = await page.text();
      const assetUrls = [...html.matchAll(/src="([^"]+)"/g)].map(
        (match) => match[1]!
      );
      const buttons = [
        ...html.matchAll(/<button[^>]*data-lab-option[^>]*>/g),
      ].map((match) => match[0].replace(/"[^"]*"/g, '""'));
      // Opaque ids are random; a digit run inside one is not a leak.
      const withoutIds = html.replace(/[A-Za-z0-9_-]{22}/g, '');

      expect(new Set(buttons).size).toBeLessThanOrEqual(1);
      for (const text of [
        html,
        ...assetUrls,
        JSON.stringify(page.headers.toJSON()),
      ]) {
        expect(text).not.toContain(String(SEED));
        expect(text.toLowerCase()).not.toMatch(
          /\b(correct|answer|seed|rank)\b/
        );
      }
      const right = rightDecision(family, SEED);
      if (right.kind === 'text') {
        expect(withoutIds).not.toContain(right.text);
      }
      for (const url of assetUrls) {
        const asset = await lab.fetch(
          new Request(`${LAB_ORIGIN}${url}`, {
            headers: { [SESSION_HEADER]: 'session-1' },
          })
        );
        const bytes = Buffer.from(await asset.arrayBuffer()).toString('latin1');
        expect(asset.headers.get('content-type')).toBe('image/png');
        expect(bytes).not.toMatch(/tEXt|iTXt|zTXt|tIME/);
      }
    });

    test('the server refuses a response of the wrong kind without using the attempt', async () => {
      const lab = createLab();
      const issued = lab.issue(family, 'session-1');
      await lab.fetch(
        new Request(LAB_URL, {
          headers: {
            [CAPABILITY_HEADER]: issued.capability,
            [SESSION_HEADER]: 'session-1',
          },
        })
      );
      const wrongKind =
        FAMILIES[family].kind === 'text'
          ? { kind: 'choice', optionId: 'x' }
          : { kind: 'text', text: '12345' };

      const response = await lab.fetch(
        new Request(`${LAB_ORIGIN}${LAB_SUBMIT_PATH}`, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            [SESSION_HEADER]: 'session-1',
          },
          body: JSON.stringify({
            challengeId: issued.challengeId,
            response: wrongKind,
          }),
        })
      );

      expect(response.status).toBe(403);
      expect(lab.stats().submissions).toBe(0);
      expect(lab.status(issued.runId, issued.challengeId)).toBe('pending');
    });

    test('the right response is solved and a wrong one incorrect', async () => {
      const solvedLab = createLab({ random: seededRandom(SEED) });
      handler = solvedLab.fetch;
      const solved = await run(solvedLab, family, () =>
        rightDecision(family, SEED)
      ).record;

      const wrongLab = createLab({ random: seededRandom(SEED) });
      handler = wrongLab.fetch;
      const wrong = await run(wrongLab, family, () =>
        wrongDecision(family, SEED)
      ).record;

      expect(solved.outcome).toBe('solved');
      expect(solved.family).toBe(family);
      expect(solved.plannerCalls).toBe(1);
      expect(solved.actions).toHaveLength(1);
      expect(wrong.outcome).toBe('incorrect');
      expect(wrong.actions).toHaveLength(1);
      for (const record of [solved, wrong]) {
        const text = JSON.stringify(record);
        expect(text).not.toContain(String(SEED));
        expect(text.toLowerCase()).not.toMatch(
          /\b(correct|seed|rank)\b|data-lab-option/
        );
      }
      expect(solvedLab.stats().submissions).toBe(1);
      expect(wrongLab.stats().submissions).toBe(1);
    });

    test('a response outside the family bounds takes no action', async () => {
      const lab = createLab();
      handler = lab.fetch;
      const outOfBounds: PlannerDecision =
        FAMILIES[family].kind === 'text'
          ? { kind: 'text', text: '12a45' }
          : FAMILIES[family].kind === 'order'
            ? { kind: 'order', labels: ['A', 'A', 'B', 'C'] }
            : { kind: 'choice', label: 'Z' };

      const record = await run(lab, family, () => outOfBounds).record;

      expect(record.outcome).toBe('model_error');
      expect(record.detail).toBe('answer_outside_spec');
      expect(record.actions).toHaveLength(0);
      expect(lab.stats().submissions).toBe(0);
    });

    const negatives: [string, (lab: Lab) => Handler, string | undefined][] = [
      ['no capability', (lab) => lab.fetch, ''],
      [
        'a navigation away',
        (lab) => async (request) => {
          const response = await lab.fetch(request);
          if (new URL(request.url).pathname !== LAB_PATH) return response;
          const html = (await response.text()).replace(
            '</body>',
            `<script>location.href = '/lab/elsewhere';</script></body>`
          );
          return new Response(html, {
            headers: { 'content-type': 'text/html' },
          });
        },
        undefined,
      ],
      [
        'a third-party asset',
        (lab) => async (request) => {
          const response = await lab.fetch(request);
          if (new URL(request.url).pathname !== LAB_PATH) return response;
          const html = (await response.text()).replace(
            '</body>',
            '<img src="http://127.0.0.2:47832/pixel.png"></body>'
          );
          return new Response(html, {
            headers: { 'content-type': 'text/html' },
          });
        },
        undefined,
      ],
    ];

    for (const [name, makeHandler, capability] of negatives) {
      test(`${name}: zero planner calls and zero actions`, async () => {
        const lab = createLab();
        handler = makeHandler(lab);

        const { record, calls } = run(
          lab,
          family,
          () => rightDecision(family, SEED),
          capability
        );
        const result = await record;

        expect(result.outcome).toBe('provenance_rejected');
        expect(result.plannerCalls).toBe(0);
        expect(calls()).toBe(0);
        expect(result.actions).toHaveLength(0);
        expect(lab.stats().submissions).toBe(0);
      });
    }
  });
}
