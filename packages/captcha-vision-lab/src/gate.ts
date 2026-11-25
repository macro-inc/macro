/**
 * The provenance gate. It decides from what the runner saw in its own browser
 * and from the lab service's attestation; the planner never sees or
 * influences it. Any doubt is a rejection.
 */

import { LAB_URL } from './registry.ts';
import type { Attestation } from './server.ts';

/** What the runner's browser hooks recorded during the run. */
export type Observations = {
  mainFrameUrl: string | undefined;
  mainNavigations: number;
  redirects: number;
  popups: number;
  extraFrames: number;
  /** Origins of requests the route allowlist aborted. */
  blockedOrigins: string[];
  /** Navigations the route allowlist aborted. */
  blockedNavigations: number;
};

export type GateStage =
  | 'before_navigation'
  | 'before_planner'
  | 'before_action'
  | 'after_action';

export type GateDecision =
  | { stage: GateStage; allowed: true }
  | { stage: GateStage; allowed: false; reason: string };

export const emptyObservations = (): Observations => ({
  mainFrameUrl: undefined,
  mainNavigations: 0,
  redirects: 0,
  popups: 0,
  extraFrames: 0,
  blockedOrigins: [],
  blockedNavigations: 0,
});

/** Before the browser starts: a capability and the exact registered URL. */
export const checkTarget = (
  targetUrl: string,
  capability: string | undefined
): GateDecision => {
  const stage = 'before_navigation';
  if (capability === undefined || capability === '') {
    return { stage, allowed: false, reason: 'missing_capability' };
  }
  if (targetUrl !== LAB_URL) {
    return { stage, allowed: false, reason: 'unregistered_url' };
  }
  return { stage, allowed: true };
};

/** What the browser saw: before the planner, before the action, and after it. */
export const checkObservations = (
  stage: 'before_planner' | 'before_action' | 'after_action',
  observed: Observations
): GateDecision => {
  const failures: [boolean, string][] = [
    [observed.redirects > 0, 'redirect'],
    [observed.popups > 0, 'popup'],
    [observed.extraFrames > 0, 'extra_frame'],
    [observed.blockedNavigations > 0, 'blocked_navigation'],
    [observed.blockedOrigins.length > 0, 'non_lab_request'],
    [observed.mainFrameUrl !== LAB_URL, 'main_frame_url'],
    [observed.mainNavigations !== 1, 'navigation'],
  ];
  const failure = failures.find(([failed]) => failed);
  if (failure !== undefined) {
    return { stage, allowed: false, reason: failure[1] };
  }
  return { stage, allowed: true };
};

/**
 * Before the planner call and before the action: the browser's observations,
 * and the service attests this session opened the challenge, still pending.
 */
export const checkPage = (
  stage: 'before_planner' | 'before_action',
  observed: Observations,
  attestation: Attestation
): GateDecision => {
  const seen = checkObservations(stage, observed);
  if (!seen.allowed) return seen;
  if (!attestation.opened) {
    return { stage, allowed: false, reason: 'not_attested' };
  }
  if (attestation.status !== 'pending') {
    return { stage, allowed: false, reason: 'challenge_not_pending' };
  }
  return seen;
};
