/**
 * The lab challenge service. It generates a fresh challenge of the asked
 * family, keeps the right response on the server, and scores one
 * submission per challenge. The browser sees only the prompt, opaque option
 * ids and opaque image URLs. Issuing, attesting and reading a challenge's
 * status are in-process calls for the runner, never HTTP routes.
 */
import { z } from 'zod';
import { signCapability, verifyCapability } from './capability.ts';
import {
  type Challenge,
  FAMILIES,
  type FamilyName,
  TEXT_PATTERN,
} from './families.ts';
import { renderPage } from './page.ts';
import { cryptoRandom, type Random } from './random.ts';
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

type Stored = {
  runId: string;
  sessionNonce: string;
  challenge: Challenge;
  /** Opaque ids, one per option, in the challenge's option order. */
  optionIds: string[];
  /** Opaque image URLs' tokens and their images. */
  assets: Map<string, Uint8Array>;
  figureToken: string | undefined;
  optionTokens: (string | undefined)[];
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
  /** Challenge content randomness; tests pass a seeded source. */
  random?: Random;
  now?: () => number;
  capabilityTtlMs?: number;
  challengeTtlMs?: number;
};

const SUBMISSIONS_PER_CHALLENGE = 1;

const SubmitBody = z.strictObject({
  challengeId: z.string(),
  response: z.discriminatedUnion('kind', [
    z.strictObject({ kind: z.literal('choice'), optionId: z.string() }),
    z.strictObject({
      kind: z.literal('order'),
      optionIds: z.array(z.string()).max(8),
    }),
    z.strictObject({ kind: z.literal('text'), text: z.string().max(32) }),
  ]),
});
type Submission = z.infer<typeof SubmitBody>['response'];

const opaqueId = (): string =>
  Buffer.from(crypto.getRandomValues(new Uint8Array(16))).toString('base64url');

const rejected = (): Response =>
  new Response('rejected', {
    status: 403,
    headers: { 'cache-control': 'no-store' },
  });

const json = (body: { status: ChallengeStatus }, status = 200): Response =>
  Response.json(body, { status, headers: { 'cache-control': 'no-store' } });

/**
 * Scores a submission against the stored challenge: right, wrong, or not a
 * well-formed response to this challenge at all (refused, no attempt used).
 */
const score = (
  stored: Stored,
  submission: Submission
): 'solved' | 'incorrect' | 'malformed' => {
  const { challenge, optionIds } = stored;
  if (submission.kind === 'choice' && challenge.kind === 'choice') {
    const index = optionIds.indexOf(submission.optionId);
    if (index < 0) return 'malformed';
    return challenge.options[index]!.correct ? 'solved' : 'incorrect';
  }

  if (submission.kind === 'order' && challenge.kind === 'order') {
    const indexes = submission.optionIds.map((id) => optionIds.indexOf(id));
    const complete =
      indexes.length === optionIds.length &&
      new Set(indexes).size === indexes.length &&
      indexes.every((index) => index >= 0);
    if (!complete) return 'malformed';
    const inOrder = indexes.every(
      (index, position) => challenge.options[index]!.rank === position
    );
    return inOrder ? 'solved' : 'incorrect';
  }

  if (submission.kind === 'text' && challenge.kind === 'text') {
    if (!TEXT_PATTERN.test(submission.text)) return 'malformed';
    return submission.text === challenge.text ? 'solved' : 'incorrect';
  }
  return 'malformed';
};

/** Gives every image an opaque URL token. */
const store = (
  runId: string,
  sessionNonce: string,
  challenge: Challenge,
  expiresAt: number
): Stored => {
  const assets = new Map<string, Uint8Array>();
  const tokenFor = (image: Uint8Array | undefined): string | undefined => {
    if (image === undefined) return undefined;
    const token = opaqueId();
    assets.set(token, image);
    return token;
  };
  const options = challenge.kind === 'text' ? [] : challenge.options;
  const figure = challenge.kind === 'order' ? undefined : challenge.figure;
  return {
    runId,
    sessionNonce,
    challenge,
    optionIds: options.map(() => opaqueId()),
    assets,
    figureToken: tokenFor(figure),
    optionTokens: options.map((option) => tokenFor(option.image)),
    expiresAt,
    opened: false,
    submissions: 0,
    scored: undefined,
  };
};

const page = (challengeId: string, stored: Stored): Response => {
  const { challenge } = stored;
  const urlOf = (token: string | undefined) =>
    token === undefined ? undefined : `${LAB_ASSET_PATH_PREFIX}${token}`;
  const options = challenge.kind === 'text' ? [] : challenge.options;
  return renderPage({
    challengeId,
    kind: challenge.kind,
    prompt: challenge.prompt,
    figureUrl: urlOf(stored.figureToken),
    options: options.map((option, index) => ({
      optionId: stored.optionIds[index]!,
      label: option.label,
      imageUrl: urlOf(stored.optionTokens[index]),
    })),
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
  const challenges = new Map<string, Stored>();
  const consumedCapabilities = new Set<string>();
  const stats: LabStats = { pageLoads: 0, rejectedRequests: 0, submissions: 0 };

  const statusOf = (challenge: Stored): ChallengeStatus => {
    if (challenge.scored !== undefined) return challenge.scored;
    if (now() >= challenge.expiresAt) return 'expired';
    return 'pending';
  };

  /** Creates a challenge of a family for a run, and the capability that opens it. */
  const issue = (family: FamilyName, sessionNonce: string): IssuedChallenge => {
    const runId = crypto.randomUUID();
    const challengeId = opaqueId();
    const capabilityId = crypto.randomUUID();
    const challenge = FAMILIES[family].generate(random);
    challenges.set(
      challengeId,
      store(runId, sessionNonce, challenge, now() + challengeTtlMs)
    );

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
    const token = url.pathname.slice(LAB_ASSET_PATH_PREFIX.length);
    const image = sessionChallenge(request)?.assets.get(token);
    if (image === undefined) return rejected();
    return new Response(new Uint8Array(image), {
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

    const verdict = score(challenge, parsed.data.response);
    if (verdict === 'malformed') return rejected();

    challenge.submissions += 1;
    stats.submissions += 1;
    challenge.scored = verdict;
    return json({ status: verdict });
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
