import { thrownResultErrorHasCode } from '@core/util/result';

/**
 * Error codes that definitively revoke a viewer's cached thread source.
 * UNAUTHORIZED is excluded: it can be a latched token-refresh failure, and a
 * session that really ended is cleared by the app's own sign-out.
 */
export const EMAIL_ACCESS_DENIED_CODES: readonly string[] = [
  'FORBIDDEN',
  'NOT_FOUND',
];

export function isEmailAccessDenied(error: unknown): boolean {
  return EMAIL_ACCESS_DENIED_CODES.some((code) =>
    thrownResultErrorHasCode(error, code)
  );
}
