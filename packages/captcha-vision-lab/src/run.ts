/**
 * One lab challenge, end to end: its own Chromium process and temporary
 * profile, the provenance gate, one planner call, one click on the chosen
 * option's control, and the server's verdict. Every failure ends the attempt
 * with no further planner call or action.
 */
import { mkdtemp, rm } from 'node:fs/promises';
import { request as httpRequest } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  type BrowserContext,
  chromium,
  type Page,
  type Request,
  type Route,
} from 'playwright';
import {
  checkObservations,
  checkPage,
  checkTarget,
  emptyObservations,
  type GateDecision,
  type Observations,
} from './gate.ts';
import {
  type Planner,
  PlannerError,
  type PlannerResult,
  type TokenUsage,
} from './planner.ts';
import {
  CAPABILITY_HEADER,
  LAB_HOST,
  LAB_ORIGIN,
  LAB_PORT,
  LAB_SUBMIT_PATH,
  SESSION_HEADER,
} from './registry.ts';
import type { Attestation, ChallengeStatus } from './server.ts';

export type Outcome =
  | 'solved'
  | 'incorrect'
  | 'expired'
  | 'provenance_rejected'
  | 'model_error'
  | 'aborted'
  | 'action_error'
  | 'timeout';

/** The per-challenge record. It never holds option ids, the answer or a seed. */
export type RunRecord = {
  runId: string;
  capabilityId: string | undefined;
  origin: string;
  targetUrl: string;
  provider: Planner['provider'];
  model: string;
  responseModel: string | undefined;
  gate: GateDecision[];
  plannerCalls: number;
  actions: { kind: 'choose'; label: string }[];
  outcome: Outcome;
  detail: string | undefined;
  usage: TokenUsage | undefined;
  timings: {
    startedAt: string;
    totalMs: number;
    plannerMs: number | undefined;
  };
};

/** The lab service calls the runner may make, all in-process. */
export type LabAuthority = {
  attest: (
    runId: string,
    challengeId: string,
    sessionNonce: string
  ) => Attestation;
  status: (runId: string, challengeId: string) => ChallengeStatus | undefined;
};

export type RunInput = {
  lab: LabAuthority;
  planner: Planner;
  runId: string;
  challengeId: string;
  capabilityId: string | undefined;
  capability: string | undefined;
  sessionNonce: string;
  targetUrl: string;
  /** A Chromium binary; Playwright's own build when unset. */
  executablePath?: string;
  /** The whole attempt's wall-clock budget; three minutes when unset. */
  deadlineMs?: number;
};

/** Spec §11: at most three minutes of wall clock per challenge. */
const CHALLENGE_DEADLINE_MS = 180_000;
/** How long closing the browser may take before the attempt moves on. */
const CLOSE_TIMEOUT_MS = 10_000;
/** How long one request to the lab may take. */
const LAB_REQUEST_TIMEOUT_MS = 10_000;

const QUIZ_SELECTOR = '#quiz';
const PROMPT_SELECTOR = '#prompt';
const OPTION_SELECTOR = 'button[data-lab-option]';
const CLICK_TIMEOUT_MS = 5_000;
/**
 * The only environment variables the browser gets. Everything else stays
 * out: a dev shell's LD_LIBRARY_PATH or GIO module paths would load
 * libraries Playwright's Chromium can't use, and proxy or credential
 * variables have no business in the lab browser.
 */
const BROWSER_ENVIRONMENT = [
  'HOME',
  'PATH',
  'TMPDIR',
  'LANG',
  'TZ',
  'FONTCONFIG_FILE',
  'FONTCONFIG_PATH',
];

/**
 * How the lab browser is launched. Below the request allowlist, the network
 * itself goes nowhere: every connection but the lab's goes to a dead proxy
 * (nothing listens on the discard port; loopback is proxied too, so other
 * local ports are out of reach), WebRTC may not go around the proxy, and
 * there is no DNS prefetching. The environment is an allowlist.
 */
export const isolatedBrowser = () => ({
  proxy: {
    server: 'http://127.0.0.1:9',
    bypass: `<-loopback>,${LAB_HOST}:${LAB_PORT}`,
  },
  args: [
    '--force-webrtc-ip-handling-policy=disable_non_proxied_udp',
    '--dns-prefetch-disable',
  ],
  env: Object.fromEntries(
    BROWSER_ENVIRONMENT.flatMap((name) => {
      const value = process.env[name];
      return value === undefined ? [] : [[name, value]];
    })
  ),
});
const AFTER_ACTION_QUIET_MS = 500;

/**
 * Whether a navigation request is for the run's own main frame. A popup's
 * first request has no frame yet, which Playwright reports by throwing.
 */
const isMainFrame = (request: Request, page: Page): boolean => {
  try {
    return request.frame() === page.mainFrame();
  } catch {
    return false;
  }
};

type LabResponse = {
  status: number;
  headers: Record<string, string>;
  body: Buffer;
};

/**
 * One request to the lab origin over `node:http`. The CLI rejects proxy
 * variables before startup because this request may carry the capability.
 * `node:http` preserves the response bytes and headers and leaves redirects
 * for the caller to reject.
 */
const labRequest = (
  url: string,
  method: string,
  headers: Record<string, string>,
  body: Buffer | null
): Promise<LabResponse> =>
  new Promise((resolve, reject) => {
    // A fresh connection per request, and a bound on it: a request that
    // stalls fails the route instead of leaving the browser waiting on it.
    const outgoing = httpRequest(
      url,
      { method, headers, agent: false },
      (incoming) => {
        const chunks: Buffer[] = [];
        incoming.on('data', (chunk: Buffer) => chunks.push(chunk));
        incoming.on('error', reject);
        incoming.on('end', () => {
          const flat: Record<string, string> = {};
          for (const [name, value] of Object.entries(incoming.headers)) {
            if (value !== undefined) {
              flat[name] = Array.isArray(value) ? value.join(', ') : value;
            }
          }
          resolve({
            status: incoming.statusCode ?? 502,
            headers: flat,
            body: Buffer.concat(chunks),
          });
        });
      }
    );
    outgoing.on('error', reject);
    outgoing.setTimeout(LAB_REQUEST_TIMEOUT_MS, () =>
      outgoing.destroy(new Error('lab request timed out'))
    );
    outgoing.end(body ?? undefined);
  });

/**
 * Sends an allowed request from the runner itself (the browser's own
 * network is a dead proxy; only the lab origin reaches this point), never
 * following a redirect: a redirect is recorded and the request fails.
 */
const forward = async (
  route: Route,
  headers: Record<string, string>,
  observed: Observations
) => {
  const request = route.request();
  let response: LabResponse;
  try {
    response = await labRequest(
      request.url(),
      request.method(),
      headers,
      request.postDataBuffer()
    );
  } catch {
    await route.abort('failed');
    return;
  }
  if (response.status >= 300 && response.status < 400) {
    observed.redirects += 1;
    await route.abort('blockedbyclient');
    return;
  }
  await route.fulfill(response);
};

/**
 * Closes the run's browser, giving up after a bound: a browser that will
 * not close is left to Playwright, which kills it when the process exits.
 */
const closeSession = async (session: Session | undefined) => {
  if (session === undefined) return;
  await Promise.race([
    session.context.close().catch(() => undefined),
    new Promise((resolve) => setTimeout(resolve, CLOSE_TIMEOUT_MS)),
  ]);
};

type Session = {
  context: BrowserContext;
  page: Page;
  observed: Observations;
};

/**
 * Launches a dedicated Chromium with a fresh profile and one context. Every
 * request goes through an allowlist: only the lab origin passes, the page
 * request alone carries the capability, and only the first main-frame
 * navigation to the target is allowed.
 */
const openSession = async (
  input: RunInput,
  profile: string
): Promise<Session> => {
  const context = await chromium.launchPersistentContext(profile, {
    headless: true,
    executablePath: input.executablePath,
    serviceWorkers: 'block',
    acceptDownloads: false,
    viewport: { width: 900, height: 900 },
    ...isolatedBrowser(),
  });
  const observed = emptyObservations();
  const page = context.pages()[0] ?? (await context.newPage());
  let navigationAllowed = true;

  // A popup is recorded and closed at once; its requests hit the allowlist
  // below like any other.
  context.on('page', async (opened) => {
    if (opened === page) return;
    observed.popups += 1;
    await opened.close();
  });
  page.on('frameattached', () => {
    observed.extraFrames += 1;
  });
  // The profile's initial about:blank is not a navigation of the run.
  page.on('framenavigated', (frame) => {
    if (frame !== page.mainFrame() || frame.url() === 'about:blank') return;
    observed.mainNavigations += 1;
    observed.mainFrameUrl = frame.url();
  });

  // The request allowlist does not see WebSockets: refuse every one.
  await context.routeWebSocket(/.*/, async (socket) => {
    observed.blockedOrigins.push(new URL(socket.url()).origin);
    await socket.close();
  });

  await context.route('**/*', async (route: Route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.origin !== LAB_ORIGIN) {
      observed.blockedOrigins.push(url.origin);
      await route.abort('blockedbyclient');
      return;
    }

    const headers = {
      ...request.headers(),
      [SESSION_HEADER]: input.sessionNonce,
    };
    if (!request.isNavigationRequest()) {
      await forward(route, headers, observed);
      return;
    }

    if (
      !navigationAllowed ||
      request.url() !== input.targetUrl ||
      !isMainFrame(request, page)
    ) {
      observed.blockedNavigations += 1;
      await route.abort('blockedbyclient');
      return;
    }

    navigationAllowed = false;
    await forward(
      route,
      { ...headers, [CAPABILITY_HEADER]: input.capability ?? '' },
      observed
    );
  });

  return { context, page, observed };
};

/** Loads the target and lets the page's network settle before the gate. */
const load = async ({ page }: Session, targetUrl: string) => {
  const response = await page.goto(targetUrl, { waitUntil: 'load' });
  await page.waitForLoadState('networkidle');
  if (response === null || response.status() !== 200) {
    throw new Error('lab page did not answer 200');
  }
};

/**
 * A fixed description of a failure for the record. Error messages are never
 * recorded: Playwright's quote the page's markup (option ids included) and a
 * provider's can quote model output.
 */
const failureCode = (error: unknown): string => {
  if (error instanceof PlannerError) return error.code;
  if (error instanceof Error) return error.name;
  return 'unknown';
};

export const runChallenge = async (input: RunInput): Promise<RunRecord> => {
  const started = performance.now();
  const record: RunRecord = {
    runId: input.runId,
    capabilityId: input.capabilityId,
    origin: LAB_ORIGIN,
    targetUrl: input.targetUrl,
    provider: input.planner.provider,
    model: input.planner.model,
    responseModel: undefined,
    gate: [],
    plannerCalls: 0,
    actions: [],
    outcome: 'provenance_rejected',
    detail: undefined,
    usage: undefined,
    timings: {
      startedAt: new Date().toISOString(),
      totalMs: 0,
      plannerMs: undefined,
    },
  };
  // The first outcome stands: once the deadline has finished the record, a
  // late step of the attempt cannot change it.
  let finished = false;
  const finish = (outcome: Outcome, detail?: string): RunRecord => {
    if (finished) return record;
    finished = true;
    record.outcome = outcome;
    record.detail = detail;
    record.timings.totalMs = Math.round(performance.now() - started);
    return record;
  };
  // Records a gate decision; a rejection ends the attempt.
  const rejectedBy = (decision: GateDecision): RunRecord | undefined => {
    record.gate.push(decision);
    if (decision.allowed) return undefined;
    return finish('provenance_rejected', decision.reason);
  };
  const attestation = () =>
    input.lab.attest(input.runId, input.challengeId, input.sessionNonce);

  const targetRejection = rejectedBy(
    checkTarget(input.targetUrl, input.capability)
  );
  if (targetRejection !== undefined) return targetRejection;

  const deadline = AbortSignal.timeout(
    input.deadlineMs ?? CHALLENGE_DEADLINE_MS
  );
  const profile = await mkdtemp(join(tmpdir(), 'captcha-vision-lab-'));
  let session: Session | undefined;

  // The attempt itself. Every await in it is bounded on its own, but only
  // the deadline below bounds them together; past it, nothing more happens.
  const attempt = async (): Promise<RunRecord> => {
    const opened = await openSession(input, profile);
    session = opened;
    if (deadline.aborted) return record;
    const { page, observed } = opened;

    try {
      await load(session, input.targetUrl);
    } catch (error) {
      // Name what the browser saw (a redirect, say) when it explains the
      // failure; otherwise the load itself failed.
      const seen = checkObservations('before_planner', observed);
      if (!seen.allowed)
        return rejectedBy(seen) ?? finish('provenance_rejected');
      const reason = 'page_load_failed';
      record.gate.push({ stage: 'before_planner', allowed: false, reason });
      return finish('provenance_rejected', `${reason}: ${failureCode(error)}`);
    }

    const plannerRejection = rejectedBy(
      checkPage('before_planner', observed, attestation())
    );
    if (plannerRejection !== undefined) return plannerRejection;

    const quiz = page.locator(QUIZ_SELECTOR);
    const prompt = (await page.locator(PROMPT_SELECTOR).innerText()).trim();
    const controls = page.locator(OPTION_SELECTOR).filter({ visible: true });
    const labels = (await controls.locator('.label').allInnerTexts()).map(
      (label) => label.trim()
    );
    const screenshot = await quiz.screenshot({ type: 'png' });

    // Reading the page takes time too: check again that what the planner
    // will see still comes from the gated page.
    const inputRejection = rejectedBy(
      checkPage('before_planner', observed, attestation())
    );
    if (inputRejection !== undefined) return inputRejection;

    // Exactly one planner call per challenge.
    record.plannerCalls += 1;
    const plannerStarted = performance.now();
    let planned: PlannerResult;
    try {
      planned = await input.planner.plan(
        { screenshot, prompt, labels },
        deadline
      );
    } catch (error) {
      record.timings.plannerMs = Math.round(performance.now() - plannerStarted);
      return finish('model_error', failureCode(error));
    }
    record.timings.plannerMs = Math.round(performance.now() - plannerStarted);
    record.usage = planned.usage;
    record.responseModel = planned.responseModel;

    if (planned.decision.kind === 'abort') {
      // The abort's reason is model output: record that it aborted, not why.
      return finish('aborted', 'model_aborted');
    }
    const label = planned.decision.label;
    if (!labels.includes(label)) {
      return finish('model_error', 'choice is not a visible option label');
    }
    const control = controls.filter({
      has: page.locator('.label').getByText(label, { exact: true }),
    });
    if ((await control.count()) !== 1) {
      return finish('action_error', 'no single control for the chosen label');
    }

    const actionRejection = rejectedBy(
      checkPage('before_action', observed, attestation())
    );
    if (actionRejection !== undefined) return actionRejection;
    // No action once the deadline has passed.
    if (deadline.aborted) return record;

    // Exactly one action: click the chosen option's registered control,
    // which submits it once.
    record.actions.push({ kind: 'choose', label });
    try {
      await Promise.all([
        page.waitForResponse(
          (response) => response.url() === `${LAB_ORIGIN}${LAB_SUBMIT_PATH}`
        ),
        control.click({ timeout: CLICK_TIMEOUT_MS }),
      ]);
    } catch (error) {
      return finish('action_error', failureCode(error));
    }

    // Anything the click set off (a popup, a foreign request, a navigation)
    // voids the attempt, whatever the server scored. Browser events reach us
    // in no fixed order with the submit response, so watch a quiet window
    // first, as long as the one networkidle gives before the planner.
    await page.waitForTimeout(AFTER_ACTION_QUIET_MS);
    const afterAction = checkObservations('after_action', observed);
    record.gate.push(afterAction);
    if (!afterAction.allowed) {
      return finish('provenance_rejected', afterAction.reason);
    }

    // Only the lab service's own status decides the outcome.
    const verdict = input.lab.status(input.runId, input.challengeId);
    if (
      verdict === 'solved' ||
      verdict === 'incorrect' ||
      verdict === 'expired'
    ) {
      return finish(verdict);
    }
    return finish('action_error', `challenge is ${verdict ?? 'unknown'}`);
  };

  // Whichever comes first: the attempt's own outcome, or the deadline's
  // `timeout`. Either way the record is returned and kept.
  const timedOut = new Promise<RunRecord>((resolve) => {
    deadline.addEventListener(
      'abort',
      () => resolve(finish('timeout', 'challenge_deadline')),
      { once: true }
    );
  });
  try {
    return await Promise.race([
      attempt().catch((error: unknown) =>
        finish('action_error', failureCode(error))
      ),
      timedOut,
    ]);
  } finally {
    await closeSession(session);
    await rm(profile, { recursive: true, force: true });
  }
};
