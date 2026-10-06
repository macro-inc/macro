import { DEFAULT_ROUTE } from '@app/constants/defaultRoute';

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
