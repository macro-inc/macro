import type { ResultError } from '@core/util/result';
import type { PreviewItemNoAccess } from './types';

/** A failed read; the forms service names a missing form in its refusal body. */
type FailedRead = ResultError & { refusal?: { code?: unknown } | null };

/** How an item whose own read failed previews: gone, or hidden from the viewer. */
export function failedReadAccess(
  errors: readonly FailedRead[]
): PreviewItemNoAccess['access'] {
  return errors.some(
    (error) =>
      error.code === 'NOT_FOUND' ||
      error.code === 'GONE' ||
      error.refusal?.code === 'notFound'
  )
    ? 'does_not_exist'
    : 'no_access';
}
