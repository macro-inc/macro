/**
 * One lab challenge, end to end: its own Chromium process and temporary
 * profile, the provenance gate, one planner call, one click on the chosen
 * option's control, and the server's verdict. Every failure ends the attempt
 * with no further planner call or action.
 */
import { mkdtemp, rm } from 'node:fs/promises';
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
  checkPage,
  checkTarget,
  emptyObservations,
  type GateDecision,
  type Observations,
} from './gate.ts';
import type { Planner, PlannerResult, TokenUsage } from './planner.ts';
import {
  CAPABILITY_HEADER,
  LAB_ORIGIN,
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
  | 'action_error';

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
};

const QUIZ_SELECTOR = '#quiz';
const PROMPT_SELECTOR = '#prompt';
const OPTION_SELECTOR = 'button[data-lab-option]';

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
  });
  const observed = emptyObservations();
  const page = context.pages()[0] ?? (await context.newPage());
  let navigationAllowed = true;

  context.on('page', (opened) => {
    if (opened !== page) observed.popups += 1;
  });
  page.on('frameattached', () => {
    observed.extraFrames += 1;
  });
  page.on('framenavigated', (frame) => {
    if (frame !== page.mainFrame()) return;
    observed.mainNavigations += 1;
    observed.mainFrameUrl = frame.url();
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
      await route.continue({ headers });
      return;
    }

    if (
      !navigationAllowed ||
      request.url() !== input.targetUrl ||
      !isMainFrame(request, page)
    ) {
      observed.blockedNavigations += 1;
      if (request.redirectedFrom() !== null) observed.redirects += 1;
      await route.abort('blockedbyclient');
      return;
    }

    navigationAllowed = false;
    await route.continue({
      headers: { ...headers, [CAPABILITY_HEADER]: input.capability ?? '' },
    });
  });

  return { context, page, observed };
};

/** Loads the target and lets the page's network settle before the gate. */
const load = async ({ page, observed }: Session, targetUrl: string) => {
  const response = await page.goto(targetUrl, { waitUntil: 'load' });
  if (response?.request().redirectedFrom()) observed.redirects += 1;
  await page.waitForLoadState('networkidle');
  if (response === null || response.status() !== 200) {
    throw new Error(`lab page answered ${response?.status() ?? 'nothing'}`);
  }
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
  const finish = (outcome: Outcome, detail?: string): RunRecord => {
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

  const profile = await mkdtemp(join(tmpdir(), 'captcha-vision-lab-'));
  let session: Session | undefined;
  try {
    session = await openSession(input, profile);
    const { page, observed } = session;

    try {
      await load(session, input.targetUrl);
    } catch (error) {
      const reason = 'page_load_failed';
      record.gate.push({ stage: 'before_planner', allowed: false, reason });
      return finish('provenance_rejected', `${reason}: ${String(error)}`);
    }

    const plannerRejection = rejectedBy(
      checkPage('before_planner', observed, attestation())
    );
    if (plannerRejection !== undefined) return plannerRejection;

    const quiz = page.locator(QUIZ_SELECTOR);
    const prompt = (await page.locator(PROMPT_SELECTOR).innerText()).trim();
    const controls = page.locator(OPTION_SELECTOR);
    const labels = (await controls.locator('.label').allInnerTexts()).map(
      (label) => label.trim()
    );
    const screenshot = await quiz.screenshot({ type: 'png' });

    // Exactly one planner call per challenge.
    record.plannerCalls += 1;
    const plannerStarted = performance.now();
    let planned: PlannerResult;
    try {
      planned = await input.planner.plan({ screenshot, prompt, labels });
    } catch (error) {
      record.timings.plannerMs = Math.round(performance.now() - plannerStarted);
      return finish('model_error', String(error));
    }
    record.timings.plannerMs = Math.round(performance.now() - plannerStarted);
    record.usage = planned.usage;
    record.responseModel = planned.responseModel;

    if (planned.decision.kind === 'abort') {
      return finish('aborted', planned.decision.reason);
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

    // Exactly one action: click the chosen option's registered control,
    // which submits it once.
    record.actions.push({ kind: 'choose', label });
    try {
      await Promise.all([
        page.waitForResponse(
          (response) => response.url() === `${LAB_ORIGIN}${LAB_SUBMIT_PATH}`
        ),
        control.click(),
      ]);
    } catch (error) {
      return finish('action_error', String(error));
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
  } finally {
    await session?.context.close();
    await rm(profile, { recursive: true, force: true });
  }
};
