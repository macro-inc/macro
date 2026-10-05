import { AFTER_SETUP_ROUTE, DEFAULT_ROUTE } from '@app/constants/defaultRoute';

/**
 * Same-app relative paths only. A `next` at the default route is not a real
 * deep link, so it falls through to the post-setup landing.
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

/** Where finishing onboarding lands: the first valid deep link, else Getting Started. */
export function afterOnboardingTarget(
  ...candidates: readonly unknown[]
): string {
  for (const candidate of candidates) {
    const next = sanitizeNext(candidate);
    if (next) return next;
  }
  return AFTER_SETUP_ROUTE;
}
