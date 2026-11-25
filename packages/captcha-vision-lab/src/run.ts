/**
 * One lab challenge, end to end: its own Chromium process and temporary
 * profile, the provenance gate, one planner call, one click on the chosen
 * option's control, and the server's verdict. Every failure ends the attempt
 * with no further planner call or action.
 */
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type BrowserHost, startBrowserHost } from './browser.ts';
import { FAMILIES, type FamilyName } from './families.ts';
import {
  checkObservations,
  checkPage,
  checkTarget,
  type GateDecision,
  type Observations,
} from './gate.ts';
import type { Action, HostReply } from './host-protocol.ts';
import {
  fitsSpec,
  type Planner,
  PlannerError,
  type PlannerResult,
  type ResponseSpec,
  type TokenUsage,
} from './planner.ts';
import { proxyVariables } from './proxy.ts';
import { LAB_ORIGIN } from './registry.ts';
import type { Attestation, ChallengeStatus } from './server.ts';

export type Outcome =
  | 'solved'
  | 'incorrect'
  | 'expired'
  | 'provenance_rejected'
  | 'model_error'
  | 'aborted'
  | 'action_error'
  | 'browser_error'
  | 'timeout';

/** The per-challenge record. It never holds option ids, the answer or a seed. */
export type RunRecord = {
  runId: string;
  family: FamilyName;
  capabilityId: string | undefined;
  origin: string;
  targetUrl: string;
  provider: Planner['provider'];
  model: string;
  responseModel: string | undefined;
  gate: GateDecision[];
  plannerCalls: number;
  actions: Action[];
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
  family: FamilyName;
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

/** The host's observations, in the gate's shape. */
const observationsOf = (
  reply: Extract<HostReply, { observations: unknown }>
): Observations => ({
  ...reply.observations,
  mainFrameUrl: reply.observations.mainFrameUrl,
});

/**
 * Closes the host's browser, giving up after a bound, then kills the host:
 * with its pipes gone, its Chromium goes too.
 */
const closeHost = async (host: BrowserHost | undefined) => {
  if (host === undefined) return;
  await Promise.race([
    host.request({ type: 'close' }).catch(() => undefined),
    new Promise((resolve) => setTimeout(resolve, CLOSE_TIMEOUT_MS)),
  ]);
  host.kill();
};

/** What the planner may answer, from the family and the captured controls. */
const specFor = (
  family: FamilyName,
  captured: Extract<HostReply, { type: 'captured'; result: 'ok' }>
): ResponseSpec | undefined => {
  const kind = FAMILIES[family].kind;
  if (kind === 'text') return captured.textControls ? { kind } : undefined;
  const { labels } = captured;
  if (labels.length === 0 || new Set(labels).size !== labels.length) {
    return undefined;
  }
  return { kind, labels };
};

/** The action a decision asks for, in the host's terms. */
const actionFor = (
  decision: Exclude<PlannerResult['decision'], { kind: 'abort' }>
): Action => {
  if (decision.kind === 'text')
    return { kind: 'transcribe', text: decision.text };
  if (decision.kind === 'order')
    return { kind: 'order', labels: decision.labels };
  return { kind: 'choose', label: decision.label };
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
    family: input.family,
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

  // The command refuses proxies too; this keeps any other caller from
  // skipping that check.
  if (proxyVariables().length > 0) {
    const reason = 'proxy_configured';
    record.gate.push({ stage: 'before_navigation', allowed: false, reason });
    return finish('provenance_rejected', reason);
  }

  const targetRejection = rejectedBy(
    checkTarget(input.targetUrl, input.capability)
  );
  if (targetRejection !== undefined) return targetRejection;

  const deadline = AbortSignal.timeout(
    input.deadlineMs ?? CHALLENGE_DEADLINE_MS
  );
  let profile: string | undefined;
  let host: BrowserHost | undefined;

  // The attempt itself. Every await in it is bounded on its own, but only
  // the deadline below bounds them together; past it, nothing more happens.
  const attempt = async (): Promise<RunRecord> => {
    host = startBrowserHost();
    if (host === undefined) return finish('browser_error', 'node_missing');
    profile = await mkdtemp(join(tmpdir(), 'captcha-vision-lab-'));

    const opened = await host.request({
      type: 'open',
      targetUrl: input.targetUrl,
      capability: input.capability ?? '',
      sessionNonce: input.sessionNonce,
      profile,
      executablePath: input.executablePath,
    });
    if (opened.type !== 'opened') {
      return finish('browser_error', 'unexpected_host_reply');
    }
    // A browser that cannot start is a kept failure, not a lost trial.
    if (opened.result === 'launch_failed') {
      return finish('browser_error', 'browser_launch_failed');
    }
    if (deadline.aborted) return record;
    if (opened.result === 'load_failed') {
      // Name what the browser saw (a redirect, say) when it explains the
      // failure; otherwise the load itself failed.
      const seen = checkObservations('before_planner', observationsOf(opened));
      if (!seen.allowed) {
        return rejectedBy(seen) ?? finish('provenance_rejected');
      }
      const reason = 'page_load_failed';
      record.gate.push({ stage: 'before_planner', allowed: false, reason });
      return finish('provenance_rejected', reason);
    }

    const plannerRejection = rejectedBy(
      checkPage('before_planner', observationsOf(opened), attestation())
    );
    if (plannerRejection !== undefined) return plannerRejection;

    const captured = await host.request({ type: 'capture' });
    if (captured.type !== 'captured') {
      return finish('browser_error', 'unexpected_host_reply');
    }
    if (captured.result === 'failed') {
      return finish('browser_error', 'page_capture_failed');
    }
    const spec = specFor(input.family, captured);
    if (spec === undefined) {
      return finish('action_error', 'page_lacks_family_controls');
    }
    const { prompt } = captured;
    const screenshot = Buffer.from(captured.screenshot, 'base64');

    // Reading the page takes time too: check again that what the planner
    // will see still comes from the gated page.
    const afterCapture = await host.request({ type: 'observe' });
    if (afterCapture.type !== 'observations') {
      return finish('browser_error', 'unexpected_host_reply');
    }
    const inputRejection = rejectedBy(
      checkPage('before_planner', observationsOf(afterCapture), attestation())
    );
    if (inputRejection !== undefined) return inputRejection;

    // Exactly one planner call per challenge.
    record.plannerCalls += 1;
    const plannerStarted = performance.now();
    let planned: PlannerResult;
    try {
      planned = await input.planner.plan(
        { screenshot, prompt, response: spec },
        deadline
      );
    } catch (error) {
      record.timings.plannerMs = Math.round(performance.now() - plannerStarted);
      if (error instanceof PlannerError) record.usage = error.usage;
      return finish('model_error', failureCode(error));
    }
    record.timings.plannerMs = Math.round(performance.now() - plannerStarted);
    record.usage = planned.usage;
    record.responseModel = planned.responseModel;

    const { decision } = planned;
    if (decision.kind === 'abort') {
      // The abort's reason is model output: record that it aborted, not why.
      return finish('aborted', 'model_aborted');
    }
    if (!fitsSpec(decision, spec)) {
      return finish('model_error', 'answer_outside_spec');
    }

    const beforeAction = await host.request({ type: 'observe' });
    if (beforeAction.type !== 'observations') {
      return finish('browser_error', 'unexpected_host_reply');
    }
    const actionRejection = rejectedBy(
      checkPage('before_action', observationsOf(beforeAction), attestation())
    );
    if (actionRejection !== undefined) return actionRejection;
    // No action once the deadline has passed.
    if (deadline.aborted) return record;

    // Exactly one action through the quiz's own controls, which submit
    // once.
    const action = actionFor(decision);
    const acted = await host.request({ type: 'act', action });
    if (acted.type !== 'acted') {
      return finish('browser_error', 'unexpected_host_reply');
    }
    if (acted.result === 'no_single_control') {
      return finish('action_error', 'no_single_control');
    }
    record.actions.push(action);
    if (acted.result === 'failed') {
      return finish('action_error', acted.code ?? 'unknown');
    }

    // Anything the action set off (a popup, a foreign request, a navigation)
    // voids the attempt, whatever the server scored.
    const afterAction = checkObservations(
      'after_action',
      observationsOf(acted)
    );
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
      // A host that ends or answers out of turn is a browser failure.
      attempt().catch(() => finish('browser_error', 'browser_host_failed')),
      timedOut,
    ]);
  } finally {
    await closeHost(host);
    if (profile !== undefined) {
      await rm(profile, { recursive: true, force: true });
    }
  }
};
