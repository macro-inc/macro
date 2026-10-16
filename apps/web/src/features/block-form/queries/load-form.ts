import { fetchFormDetail } from '@queries/storage/forms';
import type { AccessLevel } from '@service-storage/generated/schemas/accessLevel';
import type { FormDetail } from '@service-storage/generated/schemas/formDetail';

/** The block's view of a form: the viewer's form access is its access level. */
type LoadedForm = FormDetail & { userAccessLevel: AccessLevel };

/**
 * Load a form for its block, through the detail cache: the one answer gives
 * the block its access (header badge, share dialog) and the feature its
 * detail, so the two never disagree on open.
 */
export async function loadForm(id: string) {
  const result = await fetchFormDetail(id);
  return result.map(
    (detail): LoadedForm => ({ ...detail, userAccessLevel: detail.access })
  );
}
