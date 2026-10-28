const SIGNUP_STEPS = ['welcome', 'vision', 'security', 'work'] as const;
export type SignupStep = (typeof SIGNUP_STEPS)[number];

/** Only local presentation choices cross the sign-up redirect, never credentials. */
export type SignupDraft = {
  step: SignupStep;
  accent?: string;
  /** Google sign-up started from the work step; the OAuth return resumes there. */
  authenticating?: boolean;
};

const isSignupStep = (value: unknown): value is SignupStep =>
  SIGNUP_STEPS.some((step) => step === value);

const isHexColor = (value: unknown): value is string =>
  typeof value === 'string' && /^#[\da-f]{6}$/i.test(value);

/** Validates a stored draft; anything malformed reads as no draft. */
export function parseSignupDraft(raw: string | null): SignupDraft | undefined {
  let value: unknown;
  try {
    value = JSON.parse(raw ?? 'null');
  } catch {
    return undefined;
  }
  if (!value || typeof value !== 'object' || !('step' in value)) return;
  if (!isSignupStep(value.step)) return;
  return {
    step: value.step,
    accent:
      'accent' in value && isHexColor(value.accent) ? value.accent : undefined,
    authenticating:
      'authenticating' in value &&
      value.authenticating === true &&
      value.step === 'work',
  };
}

export const serializeSignupDraft = (draft: SignupDraft) =>
  JSON.stringify(draft);

export function previousSignupStep(step: SignupStep): SignupStep | undefined {
  const index = SIGNUP_STEPS.indexOf(step);
  return index > 0 ? SIGNUP_STEPS[index - 1] : undefined;
}

export function nextSignupStep(step: SignupStep): SignupStep {
  const index = SIGNUP_STEPS.indexOf(step);
  return SIGNUP_STEPS[Math.min(index + 1, SIGNUP_STEPS.length - 1)];
}
