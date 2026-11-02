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

/** How the user left a step; analytics records it and skipping can fork. */
export type StepOutcome = 'completed' | 'skipped';

/** The opening slides that share the story stage's measured handoffs. */
export type StoryStep = Extract<
  OnboardingStep,
  'welcome' | 'vision' | 'security' | 'tools'
>;

export const isStoryStep = (step: OnboardingStep): step is StoryStep =>
  step === 'welcome' ||
  step === 'vision' ||
  step === 'security' ||
  step === 'tools';

export function nextOnboardingStep(
  step: OnboardingStep,
  outcome: StepOutcome
): OnboardingStep {
  // Without a first account, offering a second account would be misleading.
  if (step === 'work' && outcome === 'skipped') return 'tools';
  const index = ONBOARDING_STEPS.indexOf(step);
  return ONBOARDING_STEPS[Math.min(index + 1, ONBOARDING_STEPS.length - 1)];
}

export function previousOnboardingStep(
  step: OnboardingStep
): OnboardingStep | undefined {
  const index = ONBOARDING_STEPS.indexOf(step);
  return index > 0 ? ONBOARDING_STEPS[index - 1] : undefined;
}

/** A `?step` value that names a current onboarding step. */
export function parseOnboardingStepParam(
  value: unknown
): OnboardingStep | undefined {
  const raw = Array.isArray(value) ? value[0] : value;
  if (typeof raw !== 'string') return undefined;
  return ONBOARDING_STEPS.find((step) => step === raw);
}

/**
 * Where to open the flow.
 * Checkout return, then saved progress (including legacy names), then a
 * `?step` link, then welcome. A Google sign-up return is passed in as `work`.
 */
export function restoreOnboardingStep(
  saved: unknown,
  checkoutReturn = false,
  requestedStep?: unknown
): OnboardingStep {
  if (checkoutReturn) return 'plan';
  const resumed = resumeSavedStep(saved);
  if (resumed) return resumed;
  return parseOnboardingStepParam(requestedStep) ?? 'welcome';
}

/** Migrate in-progress sessions from the previous flow without losing OAuth returns. */
function resumeSavedStep(saved: unknown): OnboardingStep | undefined {
  if (typeof saved !== 'string') return undefined;
  if (saved === 'email') return 'work';
  if (saved.startsWith('connect-')) return 'tools';
  if (saved === 'building' || saved === 'summary') return 'plan';
  return ONBOARDING_STEPS.find((step) => step === saved);
}
