import { ThrownResultError } from '@core/util/result';
import type { TagPromotionConflictResponse } from './generated/schemas/tagPromotionConflictResponse';

/**
 * A promote-tag call rejected because the team already owns a label with that
 * name. The colliding label rides along on the error so the caller can prompt
 * with it and then merge into it.
 */
export const TAG_NAME_CONFLICT_CODE = 'TAG_NAME_CONFLICT' as const;

/**
 * Recover the colliding team label from a thrown promote error, or `null` when
 * the failure was something else.
 */
export function parseTagNameConflict(
  error: unknown
): TagPromotionConflictResponse | null {
  if (!(error instanceof ThrownResultError)) return null;
  const conflict = error.errors.find(
    (candidate) => candidate.code === TAG_NAME_CONFLICT_CODE
  );
  if (!conflict) return null;

  try {
    const parsed = JSON.parse(conflict.message) as TagPromotionConflictResponse;
    return parsed.conflicting_option ? parsed : null;
  } catch {
    return null;
  }
}
