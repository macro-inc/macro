export const GOOGLE_WORK_ONBOARDING_PARAM = 'google-work';
export const ONBOARDING_HANDOFF_STORAGE_KEY = 'macro-onboarding-handoff-v1';
export const ONBOARDING_FLOW_STEP_STORAGE_KEY = 'onboarding-flow-step';
const HANDOFF_MAX_AGE_MS = 30 * 60 * 1_000;

type HandoffStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

export interface OnboardingHandoff {
  step: 'email';
  createdAt: number;
  next?: string;
}

/** Keep post-setup navigation within the app, including invitation routes. */
export function onboardingReturnPath(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const path =
    value === '/app' ? '/' : value.startsWith('/app/') ? value.slice(4) : value;
  if (
    !path.startsWith('/') ||
    path.startsWith('//') ||
    path.includes('\\') ||
    [...path].some((character) => character.charCodeAt(0) <= 32)
  )
    return undefined;
  return path;
}

/** Pure URL builder: the public site need not load app authentication code. */
export function buildGoogleWorkOnboardingUrl(
  loginUrl: string,
  options: { next?: string; referralCode?: string } = {}
): string {
  const url = new URL(loginUrl);
  url.searchParams.set('onboarding', GOOGLE_WORK_ONBOARDING_PARAM);
  const next = onboardingReturnPath(
    options.next ?? url.searchParams.get('next')
  );
  if (next) url.searchParams.set('next', next);
  else url.searchParams.delete('next');
  if (options.referralCode)
    url.searchParams.set('referral_code', options.referralCode);
  return url.toString();
}

/** Save on the app origin before leaving for Google, not on a preview origin. */
export function createOnboardingHandoff(
  storage: HandoffStorage,
  options: { next?: string } = {},
  now = Date.now()
): OnboardingHandoff {
  const handoff: OnboardingHandoff = {
    step: 'email',
    createdAt: now,
    next: onboardingReturnPath(options.next),
  };
  try {
    storage.setItem(ONBOARDING_HANDOFF_STORAGE_KEY, JSON.stringify(handoff));
  } catch {
    // Authentication still works if the browser blocks session storage.
  }
  return handoff;
}

export function peekOnboardingHandoff(
  storage: HandoffStorage,
  now = Date.now()
): OnboardingHandoff | undefined {
  try {
    const value = JSON.parse(
      storage.getItem(ONBOARDING_HANDOFF_STORAGE_KEY) ?? 'null'
    );
    if (
      value?.step !== 'email' ||
      typeof value.createdAt !== 'number' ||
      !Number.isFinite(value.createdAt) ||
      value.createdAt > now ||
      now - value.createdAt > HANDOFF_MAX_AGE_MS
    ) {
      storage.removeItem(ONBOARDING_HANDOFF_STORAGE_KEY);
      return undefined;
    }
    return {
      step: 'email',
      createdAt: value.createdAt,
      next: onboardingReturnPath(value.next),
    };
  } catch {
    return undefined;
  }
}

/** Call only after authentication; this is resume intent, never proof of auth. */
export function consumeOnboardingHandoff(
  storage: HandoffStorage,
  now = Date.now()
): OnboardingHandoff | undefined {
  const handoff = peekOnboardingHandoff(storage, now);
  try {
    storage.removeItem(ONBOARDING_HANDOFF_STORAGE_KEY);
  } catch {
    // Storage can be unavailable; regular onboarding remains usable.
  }
  return handoff;
}

/** An explicit signup journey outlives its single-use OAuth handoff. */
export function hasOnboardingHandoff(
  storage: HandoffStorage,
  userId?: string
): boolean {
  if (peekOnboardingHandoff(storage)) return true;
  if (!userId) return false;
  try {
    const saved = JSON.parse(
      storage.getItem(ONBOARDING_FLOW_STEP_STORAGE_KEY) ?? 'null'
    );
    return saved?.user === userId && typeof saved.step === 'string';
  } catch {
    return false;
  }
}
