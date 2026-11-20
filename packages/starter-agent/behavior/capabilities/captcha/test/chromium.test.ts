/**
 * A solve on a real Chromium, against local fixture pages and a stand-in
 * for the harness: what is sent, where the token goes, and what is observed.
 * Runs when `chromium` is on PATH (the agent's image has it).
 */
import { afterAll, beforeAll, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium, type Running } from '@macro-inc/muppet/utilities/browser';
import { passthrough } from '../../../agent/claude.ts';
import { withCurrentPage } from '../page.ts';
import { solveOnPage } from '../solve.ts';
import { recaptchaTestKey, startFixture, turnstileTestKey } from './fixture.ts';

const available = Bun.which('chromium') !== null;
const port = 9438;
const endpoint = `http://127.0.0.1:${port}`;
const token = 'XXXX.DUMMY.TOKEN.XXXX';

let profile = '';
let running: Running | undefined;
/** What happens on the page while the stand-in harness "solves": nothing, unless a test sets it. */
let duringSolve: () => Promise<void> = () => Promise.resolve();
let ownerHasTakenOver = false;
const fixture = startFixture({
  solve: async () => {
    await duringSolve();
    return { outcome: 'solved', token, userAgent: null, taskId: 'task-1' };
  },
});

beforeAll(async () => {
  if (!available) return;
  profile = await mkdtemp(join(tmpdir(), 'captcha-browser-'));
  running = await chromium({ profile, port });
});

afterAll(async () => {
  fixture.stop();
  await running?.stop();
  if (profile !== '') await rm(profile, { recursive: true, force: true });
});

const open = (path: string) =>
  withCurrentPage(endpoint, async (page) => {
    await page.goto(`${fixture.origin}${path}`);
  });

const needs = {
  withPage: <Value>(use: Parameters<typeof withCurrentPage<Value>>[1]) =>
    withCurrentPage(endpoint, use),
  relay: { url: fixture.origin, token: 'relay-capability' },
  fetch: (request: Request) => fetch(request),
  trace: passthrough,
  ownerDriving: () => Promise.resolve(ownerHasTakenOver),
};

test.skipIf(!available)(
  "Turnstile: sends only the challenge's parameters, puts the token in, and sees the page take it",
  async () => {
    await open('/turnstile?next=%2Fsecret-path');
    const outcome = await solveOnPage(needs, { solveId: 'solve-turnstile' });
    expect(outcome).toEqual({ outcome: 'solved', evidence: 'challengeGone' });

    const sent = fixture.seen.at(-1);
    expect(sent).toEqual({
      path: '/brain/captcha/solve',
      authorization: 'Bearer relay-capability',
      body: {
        solveId: 'solve-turnstile',
        challenge: {
          kind: 'turnstile',
          siteKey: turnstileTestKey,
          action: 'login',
          pageUrl: `${fixture.origin}/turnstile`,
        },
      },
    });
    const filled = await withCurrentPage(endpoint, (page) =>
      page.evaluate(() => {
        const { document } = globalThis as unknown as {
          document: {
            body: { dataset: Record<string, string> };
            querySelector: (selector: string) => { value: string } | null;
          };
        };
        return {
          callback: document.body.dataset.token,
          field: document.querySelector('[name="cf-turnstile-response"]')?.value,
        };
      })
    );
    expect(filled).toEqual({ callback: token, field: token });
  }
);

test.skipIf(!available)(
  "reCAPTCHA v2 with no callback: the token is in the form, and that's all it claims",
  async () => {
    await open('/recaptcha');
    const outcome = await solveOnPage(needs, { solveId: 'solve-recaptcha' });
    expect(outcome).toEqual({ outcome: 'injected' });
    expect(fixture.seen.at(-1)?.body).toEqual({
      solveId: 'solve-recaptcha',
      challenge: {
        kind: 'recaptchaV2',
        siteKey: recaptchaTestKey,
        invisible: false,
        enterprise: false,
        pageUrl: `${fixture.origin}/recaptcha`,
      },
    });
  }
);

test.skipIf(!available)(
  'an interstitial and a plain page never reach the harness',
  async () => {
    const before = fixture.seen.length;
    await open('/interstitial');
    expect(await solveOnPage(needs, { solveId: 'solve-interstitial' })).toEqual({
      outcome: 'unsupported',
      provider: 'cloudflareChallenge',
    });
    await open('/plain');
    expect(await solveOnPage(needs, { solveId: 'solve-plain' })).toEqual({
      outcome: 'noChallenge',
    });
    expect(fixture.seen.length).toBe(before);
  }
);

test.skipIf(!available)(
  'a hash change during the solve is not taken for a navigation',
  async () => {
    await open('/recaptcha');
    duringSolve = () =>
      withCurrentPage(endpoint, async (page) => {
        await page.evaluate(() => {
          const { history } = globalThis as unknown as {
            history: { replaceState: (data: null, unused: string, url: string) => void };
          };
          history.replaceState(null, '', '#step2');
        });
      });
    try {
      expect(await solveOnPage(needs, { solveId: 'solve-hash' })).toEqual({
        outcome: 'injected',
      });
    } finally {
      duringSolve = () => Promise.resolve();
    }
  }
);

test.skipIf(!available)(
  'the owner taking over during the solve stops it before the page is touched',
  async () => {
    await open('/turnstile');
    duringSolve = async () => {
      ownerHasTakenOver = true;
    };
    try {
      expect(await solveOnPage(needs, { solveId: 'solve-owner' })).toEqual({
        outcome: 'ownerDriving',
      });
      const field = await withCurrentPage(endpoint, (page) =>
        page.evaluate(() => {
          const { document } = globalThis as unknown as {
            document: { querySelector: (selector: string) => { value: string } | null };
          };
          return document.querySelector('[name="cf-turnstile-response"]')?.value;
        })
      );
      expect(field).toBe('');
    } finally {
      duringSolve = () => Promise.resolve();
      ownerHasTakenOver = false;
    }
  }
);
