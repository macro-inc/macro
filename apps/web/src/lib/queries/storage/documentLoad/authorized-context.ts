import { ThrownResultError } from '@core/util/result';
import type { AccessLevel } from '@service-storage/generated/schemas/accessLevel';
import { decodeJwt } from 'jose';
import { z } from 'zod';
import type { DocumentLoadBundle } from './documentLoadBundle';
import type { DocumentCacheSession } from './offline-context-cache';

const claimsSchema = z.object({
  user_id: z.string(),
  document_id: z.string(),
  access_level: z.enum(['view', 'comment', 'edit', 'owner']),
});
const rank: Record<AccessLevel, number> = {
  view: 0,
  comment: 1,
  edit: 2,
  owner: 3,
};

/** Bind a freshly fetched HTTPS response to the captured viewer, not a stale user-info cache.
 * This is not signature verification; sync-service still verifies the JWT itself.
 */
export function authorizedContext(
  documentId: string,
  session: DocumentCacheSession,
  bundle: DocumentLoadBundle
): DocumentLoadBundle {
  const deny = () =>
    new ThrownResultError([
      {
        code: 'UNAUTHORIZED',
        message: 'Document authorization does not match the current session',
      },
    ]);
  let claims: z.infer<typeof claimsSchema>;
  try {
    claims = claimsSchema.parse(decodeJwt(bundle.token));
  } catch {
    throw deny();
  }
  if (
    claims.user_id !== session.userId ||
    claims.document_id !== documentId ||
    bundle.documentMetadata.documentId !== documentId
  )
    throw deny();
  // Permissions can change between the two requests. Cache the more restrictive
  // answer; never infer a broader local grant than the fresh token allows.
  const userAccessLevel =
    rank[claims.access_level] < rank[bundle.userAccessLevel]
      ? claims.access_level
      : bundle.userAccessLevel;
  return { ...bundle, userAccessLevel };
}
