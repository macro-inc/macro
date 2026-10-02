export const SIGNUP_STEPS = ['welcome', 'vision', 'security', 'work'] as const;
export type SignupStep = (typeof SIGNUP_STEPS)[number];
export type SignupDraft = {
  step: SignupStep;
  accent?: string;
  authenticating?: boolean;
};
const KEY = 'onboarding-signup-draft';

/** Only local presentation choices cross the sign-up redirect, never credentials. */
export function readSignupDraft(): SignupDraft | undefined {
  try {
    const value = JSON.parse(sessionStorage.getItem(KEY) ?? 'null');
    if (!value || !SIGNUP_STEPS.includes(value.step)) return;
    return {
      step: value.step,
      accent:
        typeof value.accent === 'string' && /^#[\da-f]{6}$/i.test(value.accent)
          ? value.accent
          : undefined,
      authenticating: value.authenticating === true && value.step === 'work',
    };
  } catch {
    return;
  }
}

export function saveSignupDraft(draft: SignupDraft) {
  sessionStorage.setItem(KEY, JSON.stringify(draft));
}

export function clearSignupDraft() {
  sessionStorage.removeItem(KEY);
}
