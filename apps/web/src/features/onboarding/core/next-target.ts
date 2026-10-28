import { DEFAULT_ROUTE } from '@app/constants/defaultRoute';
import { parseOnboardingStepParam } from './steps';

/**
 * Same-app relative paths only. A `next` at the default route is not a real
 * deep link, so it falls through to the default landing.
 */
export function sanitizeNext(value: unknown): string | undefined {
  return typeof value === 'string' &&
    value.startsWith('/') &&
    !value.startsWith('//') &&
    !value.includes('\\') &&
    !value.startsWith(DEFAULT_ROUTE)
    ? value
    : undefined;
}

/** `/onboarding`, keeping a validated `step` from an entry link. */
export function onboardingPathWithStep(step: unknown): string {
  const parsed = parseOnboardingStepParam(step);
  return parsed ? `/onboarding?step=${parsed}` : '/onboarding';
}

/**
 * First-run redirect into onboarding. A validated `step` stays on the link.
 * Any other arrival that is not Home becomes `next`.
 */
export function onboardingRedirectPath(target: string): string {
  const queryIndex = target.indexOf('?');
  const path = queryIndex === -1 ? target : target.slice(0, queryIndex);
  const params = new URLSearchParams(
    queryIndex === -1 ? '' : target.slice(queryIndex + 1)
  );
  const step = parseOnboardingStepParam(params.get('step'));
  params.delete('step');
  const rest = params.toString();
  const withoutStep = rest ? `${path}?${rest}` : path;
  const generic = withoutStep === '/' || withoutStep.startsWith(DEFAULT_ROUTE);
  const query = new URLSearchParams();
  if (!generic) query.set('next', withoutStep);
  if (step) query.set('step', step);
  const search = query.toString();
  return search ? `/onboarding?${search}` : '/onboarding';
}

/** Where leaving onboarding lands: the first valid deep link, else Home. */
export function afterOnboardingTarget(
  ...candidates: readonly unknown[]
): string {
  for (const candidate of candidates) {
    const next = sanitizeNext(candidate);
    if (next) return next;
  }
  return DEFAULT_ROUTE;
}
