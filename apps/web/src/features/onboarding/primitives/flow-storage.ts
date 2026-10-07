import {
  parseSignupDraft,
  type SignupDraft,
  serializeSignupDraft,
} from '../core/signup-draft';
import type { OnboardingStep } from '../core/steps';

/**
 * Session state that must survive full-page round-trips: Google sign-up,
 * inbox OAuth, and Stripe checkout all reload the app mid-flow.
 */
const KEYS = {
  /** `{ user, step }`: the step to resume, scoped to who saved it. */
  step: 'onboarding-flow-step',
  /** The `?next` deep link; the inbox OAuth callback returns to bare /onboarding. */
  next: 'onboarding-flow-next',
  /** Inbox count when a connect started, to detect a landed link after reload. */
  connectBaseline: 'onboarding-flow-email-baseline',
  /** Presentation choices from the signed-out slides. */
  signupDraft: 'onboarding-signup-draft',
} as const;

function read(key: string): string | null {
  try {
    return sessionStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string | undefined) {
  try {
    if (value === undefined) sessionStorage.removeItem(key);
    else sessionStorage.setItem(key, value);
  } catch {
    // Storage blocked: the flow still works, it just can't resume.
  }
}

/** The saved step for `userId`; another user's progress is discarded. */
export function readSavedStep(userId: string): string | undefined {
  const raw = read(KEYS.step);
  if (raw === null) return undefined;
  try {
    const saved: unknown = JSON.parse(raw);
    if (
      saved &&
      typeof saved === 'object' &&
      'user' in saved &&
      saved.user === userId &&
      'step' in saved &&
      typeof saved.step === 'string'
    )
      return saved.step;
  } catch {
    // Fall through: malformed progress is discarded like a stranger's.
  }
  write(KEYS.step, undefined);
  write(KEYS.next, undefined);
  return undefined;
}

export const saveStep = (userId: string, step: OnboardingStep) =>
  write(KEYS.step, JSON.stringify({ user: userId, step }));

export const readSavedNext = () => read(KEYS.next) ?? undefined;
export const saveNext = (next: string) => write(KEYS.next, next);

/** Forget resumable progress once the user leaves onboarding for good. */
export function clearFlowProgress() {
  write(KEYS.step, undefined);
  write(KEYS.next, undefined);
}

export function readConnectBaseline(): number | undefined {
  const raw = read(KEYS.connectBaseline);
  if (raw === null) return undefined;
  const value = Number(raw);
  return Number.isFinite(value) ? value : undefined;
}

export const saveConnectBaseline = (count: number | undefined) =>
  write(KEYS.connectBaseline, count === undefined ? undefined : String(count));

export const readSignupDraft = () => parseSignupDraft(read(KEYS.signupDraft));

export const saveSignupDraft = (draft: SignupDraft) =>
  write(KEYS.signupDraft, serializeSignupDraft(draft));

export const clearSignupDraft = () => write(KEYS.signupDraft, undefined);
