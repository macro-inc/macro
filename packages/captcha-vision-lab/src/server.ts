/**
 * The lab challenge service. It generates a fresh shapes quiz per challenge,
 * keeps which option is right on the server, and scores one submission per
 * challenge. The browser sees only the prompt, opaque option ids and opaque
 * image URLs. Issuing, attesting and reading a challenge's status are
 * in-process calls for the runner, never HTTP routes.
 */
import { z } from 'zod';
import { signCapability, verifyCapability } from './capability.ts';
import { cryptoRandom, generateShapesQuiz, type Random } from './quiz.ts';
import {
  CAPABILITY_HEADER,
  LAB_ASSET_PATH_PREFIX,
  LAB_HOST,
  LAB_ORIGIN,
  LAB_PATH,
  LAB_PORT,
  LAB_SUBMIT_PATH,
  SESSION_HEADER,
} from './registry.ts';

export type ChallengeStatus = 'pending' | 'solved' | 'incorrect' | 'expired';

type Option = {
  optionId: string;
  label: string;
  assetToken: string;
  image: Uint8Array;
  correct: boolean;
};

type Challenge = {
  runId: string;
  sessionNonce: string;
  prompt: string;
  options: Option[];
  expiresAt: number;
  opened: boolean;
  submissions: number;
  scored: 'solved' | 'incorrect' | undefined;
};

export type IssuedChallenge = {
  runId: string;
  challengeId: string;
  capabilityId: string;
  capability: string;
};

export type Attestation = { opened: boolean; status: ChallengeStatus };

export type LabStats = {
  pageLoads: number;
  rejectedRequests: number;
  submissions: number;
};

export type LabOptions = {
  /** Quiz content randomness; tests pass a seeded source. */
  random?: Random;
  now?: () => number;
  capabilityTtlMs?: number;
  challengeTtlMs?: number;
};

const LABELS = ['A', 'B', 'C', 'D'];
const SUBMISSIONS_PER_CHALLENGE = 1;

const SubmitBody = z.strictObject({
  challengeId: z.string(),
  optionId: z.string(),
});

const opaqueId = (): string =>
  Buffer.from(crypto.getRandomValues(new Uint8Array(16))).toString('base64url');

const escapeHtml = (text: string): string =>
  text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');

const CONTENT_SECURITY_POLICY = [
  "default-src 'none'",
  "img-src 'self'",
  "style-src 'unsafe-inline'",
  "script-src 'unsafe-inline'",
  "connect-src 'self'",
  "frame-ancestors 'none'",
  "form-action 'none'",
  "base-uri 'none'",
].join('; ');

const rejected = (): Response =>
  new Response('rejected', {
    status: 403,
    headers: { 'cache-control': 'no-store' },
  });

const json = (body: { status: ChallengeStatus }, status = 200): Response =>
  Response.json(body, { status, headers: { 'cache-control': 'no-store' } });

const page = (challengeId: string, challenge: Challenge): Response => {
  const buttons = challenge.options
    .map(
      (option) =>
        `<button type="button" data-lab-option="${option.optionId}">` +
        `<span class="label">${option.label}</span>` +
        `<img src="${LAB_ASSET_PATH_PREFIX}${option.assetToken}" alt="" width="200" height="200">` +
        `</button>`
    )
    .join('');

  // The script submits the clicked option once and shows the server's
  // answer; it holds nothing about which option is right.
  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Shapes quiz</title>
<style>
body { font-family: sans-serif; margin: 24px; background: #fff; }
#quiz { display: inline-block; padding: 16px; border: 1px solid #ccc; }
#prompt { font-size: 18px; margin: 0 0 12px; }
.options { display: grid; grid-template-columns: repeat(2, 220px); gap: 12px; }
button { display: flex; flex-direction: column; align-items: center; padding: 6px; background: #fafafa; border: 1px solid #999; cursor: pointer; }
.label { font-size: 20px; font-weight: bold; margin-bottom: 4px; }
</style></head>
<body><main id="quiz"><p id="prompt">${escapeHtml(challenge.prompt)}</p>
<div class="options">${buttons}</div></main>
<p id="result" aria-live="polite"></p>
<script>
const challengeId = ${JSON.stringify(challengeId)};
let sent = false;
for (const button of document.querySelectorAll('[data-lab-option]')) {
  button.addEventListener('click', async () => {
    if (sent) return;
    sent = true;
    const response = await fetch(${JSON.stringify(LAB_SUBMIT_PATH)}, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ challengeId, optionId: button.dataset.labOption }),
    });
    const body = await response.json();
    document.getElementById('result').textContent = body.status;
  });
}
</script></body></html>`;

  return new Response(html, {
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-store',
      'content-security-policy': CONTENT_SECURITY_POLICY,
    },
  });
};

export const createLab = ({
  random = cryptoRandom,
  now = Date.now,
  capabilityTtlMs = 30_000,
  challengeTtlMs = 120_000,
}: LabOptions = {}) => {
  // A fresh signing secret per lab instance, i.e. per bench run.
  const secret = crypto.getRandomValues(new Uint8Array(32));
  const challenges = new Map<string, Challenge>();
  const consumedCapabilities = new Set<string>();
  const stats: LabStats = { pageLoads: 0, rejectedRequests: 0, submissions: 0 };

  const statusOf = (challenge: Challenge): ChallengeStatus => {
    if (challenge.scored !== undefined) return challenge.scored;
    if (now() >= challenge.expiresAt) return 'expired';
    return 'pending';
  };

  /** Creates a challenge for a run and the capability that opens it. */
  const issue = (sessionNonce: string): IssuedChallenge => {
    const runId = crypto.randomUUID();
    const challengeId = opaqueId();
    const capabilityId = crypto.randomUUID();
    const quiz = generateShapesQuiz(random);

    challenges.set(challengeId, {
      runId,
      sessionNonce,
      prompt: quiz.prompt,
      options: quiz.options.map((option, index) => ({
        optionId: opaqueId(),
        label: LABELS[index]!,
        assetToken: opaqueId(),
        image: option.image,
        correct: option.correct,
      })),
      expiresAt: now() + challengeTtlMs,
      opened: false,
      submissions: 0,
      scored: undefined,
    });

    const capability = signCapability(secret, {
      capabilityId,
      runId,
      challengeId,
      origin: LAB_ORIGIN,
      path: LAB_PATH,
      sessionNonce,
      expiresAt: now() + capabilityTtlMs,
    });
    return { runId, challengeId, capabilityId, capability };
  };

  /** Whether the bound session opened the challenge, and its status. */
  const attest = (
    runId: string,
    challengeId: string,
    sessionNonce: string
  ): Attestation => {
    const challenge = challenges.get(challengeId);
    if (
      challenge === undefined ||
      challenge.runId !== runId ||
      challenge.sessionNonce !== sessionNonce
    ) {
      return { opened: false, status: 'expired' };
    }
    return { opened: challenge.opened, status: statusOf(challenge) };
  };

  /** The authoritative status of a run's challenge. */
  const status = (
    runId: string,
    challengeId: string
  ): ChallengeStatus | undefined => {
    const challenge = challenges.get(challengeId);
    if (challenge === undefined || challenge.runId !== runId) return undefined;
    return statusOf(challenge);
  };

  const openPage = (request: Request, url: URL): Response => {
    const token = request.headers.get(CAPABILITY_HEADER);
    const sessionNonce = request.headers.get(SESSION_HEADER);
    const claims = token === null ? undefined : verifyCapability(secret, token);
    if (claims === undefined || sessionNonce === null) return rejected();

    const challenge = challenges.get(claims.challengeId);
    const bound =
      challenge !== undefined &&
      claims.origin === url.origin &&
      claims.path === url.pathname &&
      url.search === '' &&
      claims.sessionNonce === sessionNonce &&
      challenge.sessionNonce === sessionNonce &&
      challenge.runId === claims.runId &&
      !challenge.opened &&
      now() < claims.expiresAt &&
      statusOf(challenge) === 'pending' &&
      !consumedCapabilities.has(claims.capabilityId);
    if (!bound) return rejected();

    consumedCapabilities.add(claims.capabilityId);
    challenge.opened = true;
    stats.pageLoads += 1;
    return page(claims.challengeId, challenge);
  };

  const sessionChallenge = (request: Request) => {
    const sessionNonce = request.headers.get(SESSION_HEADER);
    if (sessionNonce === null) return undefined;
    for (const challenge of challenges.values()) {
      if (challenge.opened && challenge.sessionNonce === sessionNonce) {
        return challenge;
      }
    }
    return undefined;
  };

  const asset = (request: Request, url: URL): Response => {
    const challenge = sessionChallenge(request);
    const token = url.pathname.slice(LAB_ASSET_PATH_PREFIX.length);
    const option = challenge?.options.find(
      (candidate) => candidate.assetToken === token
    );
    if (option === undefined) return rejected();
    return new Response(new Uint8Array(option.image), {
      headers: { 'content-type': 'image/png', 'cache-control': 'no-store' },
    });
  };

  const submit = async (request: Request): Promise<Response> => {
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return rejected();
    }
    const parsed = SubmitBody.safeParse(body);
    const sessionNonce = request.headers.get(SESSION_HEADER);
    if (!parsed.success || sessionNonce === null) return rejected();

    const challenge = challenges.get(parsed.data.challengeId);
    if (
      challenge === undefined ||
      !challenge.opened ||
      challenge.sessionNonce !== sessionNonce
    ) {
      return rejected();
    }

    const current = statusOf(challenge);
    if (
      current !== 'pending' ||
      challenge.submissions >= SUBMISSIONS_PER_CHALLENGE
    ) {
      return json({ status: current }, 409);
    }

    const option = challenge.options.find(
      (candidate) => candidate.optionId === parsed.data.optionId
    );
    if (option === undefined) return rejected();

    challenge.submissions += 1;
    stats.submissions += 1;
    challenge.scored = option.correct ? 'solved' : 'incorrect';
    return json({ status: challenge.scored });
  };

  const fetch = async (request: Request): Promise<Response> => {
    const url = new URL(request.url);
    let response: Response;

    // Only the registered origin is served, whatever the socket accepted.
    if (url.origin !== LAB_ORIGIN) {
      response = rejected();
    } else if (request.method === 'GET' && url.pathname === LAB_PATH) {
      response = openPage(request, url);
    } else if (
      request.method === 'GET' &&
      url.pathname.startsWith(LAB_ASSET_PATH_PREFIX)
    ) {
      response = asset(request, url);
    } else if (request.method === 'POST' && url.pathname === LAB_SUBMIT_PATH) {
      response = await submit(request);
    } else {
      response = new Response('not found', { status: 404 });
    }

    if (response.status === 403) stats.rejectedRequests += 1;
    return response;
  };

  return { issue, attest, status, fetch, stats: () => ({ ...stats }) };
};

export type Lab = ReturnType<typeof createLab>;

type FetchHandler = (request: Request) => Promise<Response>;

/** Serves a handler on the registered loopback origin only. */
export const serveLab = (handler: FetchHandler) =>
  Bun.serve({ hostname: LAB_HOST, port: LAB_PORT, fetch: handler });
