export const ONBOARDING_STEPS = [
  'welcome',
  'vision',
  'security',
  'work',
  'personal',
  'tools',
  'team',
  'plan',
] as const;
export type OnboardingStep = (typeof ONBOARDING_STEPS)[number];

/** Migrate in-progress sessions from the previous flow without losing OAuth returns. */
export function restoreOnboardingStep(
  saved: unknown,
  checkoutReturn = false
): OnboardingStep {
  if (checkoutReturn) return 'plan';
  if (typeof saved !== 'string') return 'welcome';
  if (saved === 'email') return 'work';
  if (saved?.startsWith('connect-')) return 'tools';
  if (saved === 'building' || saved === 'summary') return 'plan';
  return ONBOARDING_STEPS.find((step) => step === saved) ?? 'welcome';
}
