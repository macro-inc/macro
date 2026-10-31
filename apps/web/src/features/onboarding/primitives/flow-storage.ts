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
  /** Tools whose connect started, so one that lands after GitHub's OAuth reload is still reported. */
  pendingConnectors: 'onboarding-flow-pending-connectors',
  /** Presentation choices from the signed-out slides. */
  signupDraft: 'onboarding-signup-draft',
} as const;

// Storage is resolved inside the try: reading `window.localStorage` itself
// throws when the browser blocks it.
type StorageArea = () => Storage;
const local: StorageArea = () => localStorage;
const session: StorageArea = () => sessionStorage;

function read(storage: StorageArea, key: string): string | null {
  try {
    return storage().getItem(key);
  } catch {
    return null;
  }
}

/** Reports whether the write landed. */
function write(
  storage: StorageArea,
  key: string,
  value: string | undefined
): boolean {
  try {
    if (value === undefined) storage().removeItem(key);
    else storage().setItem(key, value);
    return true;
  } catch {
    // Storage blocked: the flow still works, it just can't resume.
    return false;
  }
}

function readSession(key: string) {
  return read(session, key);
}

function writeSession(key: string, value: string | undefined) {
  write(session, key, value);
}

/**
 * localStorage, falling back to the per-tab record, which older builds wrote
 * and which still holds progress while localStorage is unavailable.
 */
function readStepRaw(): string | null {
  const saved = read(local, KEYS.step);
  if (saved !== null) return saved;
  const legacy = read(session, KEYS.step);
  if (legacy !== null && write(local, KEYS.step, legacy))
    write(session, KEYS.step, undefined);
  return legacy;
}

function writeStep(value: string | undefined) {
  if (write(local, KEYS.step, value) || value === undefined)
    write(session, KEYS.step, undefined);
  else write(session, KEYS.step, value);
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
  writeSession(KEYS.pendingConnectors, undefined);
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

export function readPendingConnectors(): ReadonlySet<string> {
  const raw = readSession(KEYS.pendingConnectors);
  if (raw === null) return new Set();
  try {
    const slugs: unknown = JSON.parse(raw);
    if (Array.isArray(slugs))
      return new Set(
        slugs.filter((slug): slug is string => typeof slug === 'string')
      );
  } catch {
    // Fall through: malformed state reports nothing.
  }
  return new Set();
}

export const savePendingConnectors = (slugs: ReadonlySet<string>) =>
  writeSession(
    KEYS.pendingConnectors,
    slugs.size === 0 ? undefined : JSON.stringify([...slugs])
  );

export const readSignupDraft = () =>
  parseSignupDraft(readSession(KEYS.signupDraft));

export const saveSignupDraft = (draft: SignupDraft) =>
  writeSession(KEYS.signupDraft, serializeSignupDraft(draft));

export const clearSignupDraft = () => writeSession(KEYS.signupDraft, undefined);
