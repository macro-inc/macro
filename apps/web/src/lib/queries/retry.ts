import { thrownResultErrorHasCode } from '@core/util/result';

/**
 * The retry policy queries get unless they set their own. Auth failures are
 * terminal within a session — fetchWithToken already refreshes and retries the
 * token internally, so a query-level retry just repeats the doomed request.
 */
export function defaultQueryRetry(failureCount: number, error: Error): boolean {
  if (
    thrownResultErrorHasCode(error, 'UNAUTHORIZED') ||
    thrownResultErrorHasCode(error, 'FORBIDDEN')
  ) {
    return false;
  }
  return failureCount < 1;
}
