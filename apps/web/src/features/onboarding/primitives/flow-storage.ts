import {
  parseSignupDraft,
  type SignupDraft,
  serializeSignupDraft,
} from '../core/signup-draft';
import type { OnboardingStep } from '../core/steps';

/**
 * State that must survive full-page round-trips: Google sign-up, inbox OAuth,
 * and Stripe checkout all reload the app mid-flow. The step lives in
 * localStorage so a later visit on this browser can resume it; the rest is
 * only needed for the round-trip in this tab.
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

function read(storage: Storage, key: string): string | null {
  try {
    return storage.getItem(key);
  } catch {
    return null;
  }
}

function write(storage: Storage, key: string, value: string | undefined) {
  try {
    if (value === undefined) storage.removeItem(key);
    else storage.setItem(key, value);
  } catch {
    // Storage blocked: the flow still works, it just can't resume.
  }
}

function readSession(key: string) {
  return read(sessionStorage, key);
}

function writeSession(key: string, value: string | undefined) {
  write(sessionStorage, key, value);
}

/** localStorage, with a one-time copy from the old per-tab record. */
function readStepRaw(): string | null {
  const saved = read(localStorage, KEYS.step);
  if (saved !== null) return saved;
  const legacy = read(sessionStorage, KEYS.step);
  if (legacy === null) return null;
  write(localStorage, KEYS.step, legacy);
  write(sessionStorage, KEYS.step, undefined);
  return legacy;
}

function writeStep(value: string | undefined) {
  write(localStorage, KEYS.step, value);
  write(sessionStorage, KEYS.step, undefined);
}

function savedStepFor(raw: string | null, userId: string): string | undefined {
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
  writeStep(undefined);
  writeSession(KEYS.next, undefined);
  return undefined;
}

/** The saved step for `userId`; another user's progress is discarded. */
export function readSavedStep(userId: string): string | undefined {
  return savedStepFor(readStepRaw(), userId);
}

export const saveStep = (userId: string, step: OnboardingStep) =>
  writeStep(JSON.stringify({ user: userId, step }));

export const readSavedNext = () => readSession(KEYS.next) ?? undefined;
export const saveNext = (next: string) => writeSession(KEYS.next, next);

/** Forget resumable progress once the user leaves onboarding for good. */
export function clearFlowProgress() {
  writeStep(undefined);
  writeSession(KEYS.next, undefined);
}

export function readConnectBaseline(): number | undefined {
  const raw = readSession(KEYS.connectBaseline);
  if (raw === null) return undefined;
  const value = Number(raw);
  return Number.isFinite(value) ? value : undefined;
}

export const saveConnectBaseline = (count: number | undefined) =>
  writeSession(
    KEYS.connectBaseline,
    count === undefined ? undefined : String(count)
  );

export const readSignupDraft = () =>
  parseSignupDraft(readSession(KEYS.signupDraft));

export const saveSignupDraft = (draft: SignupDraft) =>
  writeSession(KEYS.signupDraft, serializeSignupDraft(draft));

export const clearSignupDraft = () => writeSession(KEYS.signupDraft, undefined);
