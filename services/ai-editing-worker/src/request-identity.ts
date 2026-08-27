export type EditRequestIdentity =
  | { allowed: true; pseudonymousUserId?: string }
  | { allowed: false };

/** Authorize an optional backend-provided pseudonym. Browser requests without
 * one remain supported but unattributed. */
export function authorizeEditRequestIdentity(
  userId: string | undefined,
  presentedInternalKey: string | undefined,
  expectedInternalKey: string
): EditRequestIdentity {
  if (userId === undefined) return { allowed: true };
  if (
    expectedInternalKey.length === 0 ||
    presentedInternalKey !== expectedInternalKey
  ) {
    return { allowed: false };
  }
  return { allowed: true, pseudonymousUserId: userId };
}
