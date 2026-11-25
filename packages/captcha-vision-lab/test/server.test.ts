import { describe, expect, test } from 'bun:test';
import { generateShapesQuiz, seededRandom } from '../src/quiz.ts';
import {
  CAPABILITY_HEADER,
  LAB_ORIGIN,
  LAB_SUBMIT_PATH,
  LAB_URL,
  SESSION_HEADER,
} from '../src/registry.ts';
import { createLab } from '../src/server.ts';

const SEED = 918273645;

const openPage = (
  lab: ReturnType<typeof createLab>,
  capability: string,
  sessionNonce: string,
  url = LAB_URL
) =>
  lab.fetch(
    new Request(url, {
      headers: {
        [CAPABILITY_HEADER]: capability,
        [SESSION_HEADER]: sessionNonce,
      },
    })
  );

const optionIdsIn = (html: string): string[] =>
  [...html.matchAll(/data-lab-option="([^"]+)"/g)].map((match) => match[1]!);

const submit = (
  lab: ReturnType<typeof createLab>,
  challengeId: string,
  optionId: string,
  sessionNonce: string
) =>
  lab.fetch(
    new Request(`${LAB_ORIGIN}${LAB_SUBMIT_PATH}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        [SESSION_HEADER]: sessionNonce,
      },
      body: JSON.stringify({ challengeId, optionId }),
    })
  );

describe('quiz', () => {
  test('a seed reproduces the quiz and exactly one option is correct', () => {
    const first = generateShapesQuiz(seededRandom(SEED));
    const second = generateShapesQuiz(seededRandom(SEED));

    expect(second.prompt).toBe(first.prompt);
    expect(second.options.map((option) => option.correct)).toEqual(
      first.options.map((option) => option.correct)
    );
    expect(first.options.filter((option) => option.correct)).toHaveLength(1);
    expect(first.prompt).toMatch(
      /^Pick the option where the \w+ \w+ is (above|below|left of|right of) the \w+ \w+\.$/
    );
  });
});

describe('lab service', () => {
  test('the capability opens the page once, for the bound session only', async () => {
    const lab = createLab();
    const issued = lab.issue('session-1');

    expect((await openPage(lab, issued.capability, 'session-2')).status).toBe(
      403
    );
    expect((await openPage(lab, issued.capability, 'session-1')).status).toBe(
      200
    );
    expect((await openPage(lab, issued.capability, 'session-1')).status).toBe(
      403
    );
    expect(lab.attest(issued.runId, issued.challengeId, 'session-1')).toEqual({
      opened: true,
      status: 'pending',
    });
  });

  test('forged, cross-run and expired capabilities are rejected', async () => {
    let now = 1_000_000;
    const lab = createLab({ now: () => now });
    const other = createLab({ now: () => now });
    const issued = lab.issue('session-1');
    const [payload, signature] = issued.capability.split('.');
    const tampered = Buffer.from(payload!, 'base64url')
      .toString('utf8')
      .replace(issued.runId, crypto.randomUUID());
    const forged = `${Buffer.from(tampered).toString('base64url')}.${signature}`;

    expect((await openPage(lab, forged, 'session-1')).status).toBe(403);
    expect((await openPage(lab, 'not-a-capability', 'session-1')).status).toBe(
      403
    );
    // Signed by another run's secret.
    expect(
      (await openPage(lab, other.issue('session-1').capability, 'session-1'))
        .status
    ).toBe(403);

    now += 30_001;
    expect((await openPage(lab, issued.capability, 'session-1')).status).toBe(
      403
    );
    expect(
      lab.attest(issued.runId, issued.challengeId, 'session-1').opened
    ).toBe(false);
  });

  test('the capability is bound to the exact origin and path', async () => {
    const lab = createLab();
    const issued = lab.issue('session-1');

    const wrongOrigin = LAB_URL.replace('127.0.0.1', 'localhost');
    expect(
      (await openPage(lab, issued.capability, 'session-1', wrongOrigin)).status
    ).toBe(403);
    expect(
      (await openPage(lab, issued.capability, 'session-1', `${LAB_URL}?x=1`))
        .status
    ).toBe(403);
    expect(
      (
        await openPage(
          lab,
          issued.capability,
          'session-1',
          `${LAB_ORIGIN}/lab/other`
        )
      ).status
    ).toBe(404);
    expect(lab.stats().pageLoads).toBe(0);
  });

  test('a challenge takes one submission and the server alone scores it', async () => {
    const quiz = generateShapesQuiz(seededRandom(SEED));
    const correctIndex = quiz.options.findIndex((option) => option.correct);
    const lab = createLab({ random: seededRandom(SEED) });
    const issued = lab.issue('session-1');
    const html = await (
      await openPage(lab, issued.capability, 'session-1')
    ).text();
    const optionIds = optionIdsIn(html);
    const wrongIndex = (correctIndex + 1) % 4;

    expect(optionIds).toHaveLength(4);
    expect(
      (
        await submit(
          lab,
          issued.challengeId,
          optionIds[wrongIndex]!,
          'session-2'
        )
      ).status
    ).toBe(403);

    const first = await submit(
      lab,
      issued.challengeId,
      optionIds[correctIndex]!,
      'session-1'
    );
    expect(await first.json()).toEqual({ status: 'solved' });
    const replay = await submit(
      lab,
      issued.challengeId,
      optionIds[wrongIndex]!,
      'session-1'
    );
    expect(replay.status).toBe(409);
    expect(await replay.json()).toEqual({ status: 'solved' });
    expect(lab.status(issued.runId, issued.challengeId)).toBe('solved');
    expect(lab.stats().submissions).toBe(1);
  });

  test('an expired challenge cannot be submitted', async () => {
    let now = 1_000_000;
    const lab = createLab({ now: () => now });
    const issued = lab.issue('session-1');
    const html = await (
      await openPage(lab, issued.capability, 'session-1')
    ).text();

    now += 120_001;
    const response = await submit(
      lab,
      issued.challengeId,
      optionIdsIn(html)[0]!,
      'session-1'
    );
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ status: 'expired' });
    expect(lab.stats().submissions).toBe(0);
  });

  test('nothing the browser receives identifies the answer or the seed', async () => {
    const lab = createLab({ random: seededRandom(SEED) });
    const issued = lab.issue('session-1');
    const response = await openPage(lab, issued.capability, 'session-1');
    const html = await response.text();
    const assetUrls = [...html.matchAll(/src="([^"]+)"/g)].map(
      (match) => match[1]!
    );
    const buttons = [...html.matchAll(/<button[^>]*>/g)].map((match) =>
      match[0].replace(/"[^"]*"/g, '""')
    );

    // Every option control has the same shape, so none stands out.
    expect(new Set(buttons).size).toBe(1);
    for (const text of [
      html,
      ...assetUrls,
      JSON.stringify(response.headers.toJSON()),
    ]) {
      expect(text).not.toContain(String(SEED));
      expect(text.toLowerCase()).not.toMatch(/correct|answer|seed/);
    }

    for (const url of assetUrls) {
      const asset = await lab.fetch(
        new Request(`${LAB_ORIGIN}${url}`, {
          headers: { [SESSION_HEADER]: 'session-1' },
        })
      );
      expect(asset.headers.get('content-type')).toBe('image/png');
      const bytes = Buffer.from(await asset.arrayBuffer()).toString('latin1');
      // Pixels only: no text, time or other ancillary PNG chunks.
      expect(bytes).not.toMatch(/tEXt|iTXt|zTXt|tIME/);

      const withoutSession = await lab.fetch(
        new Request(`${LAB_ORIGIN}${url}`)
      );
      expect(withoutSession.status).toBe(403);
    }
  });
});
