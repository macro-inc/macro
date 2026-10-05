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

function firstDeepLink(candidates: readonly unknown[]): string | undefined {
  for (const candidate of candidates) {
    const next = sanitizeNext(candidate);
    if (next) return next;
  }
  return undefined;
}

/** Where finishing onboarding lands: the first valid deep link, else Getting Started. */
export const afterOnboardingTarget = (...candidates: readonly unknown[]) =>
  firstDeepLink(candidates) ?? AFTER_SETUP_ROUTE;

/** Where bypassing lands: the deep link, else straight in the app — Getting Started is onboarding too. */
export const bypassTarget = (...candidates: readonly unknown[]) =>
  firstDeepLink(candidates) ?? DEFAULT_ROUTE;
