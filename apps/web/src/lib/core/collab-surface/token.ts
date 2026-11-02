import { isTokenExpired } from '@core/signal/token';
import { storageServiceClient } from '@service-storage/client';

type Token = string;

/**
 * The account a surface token is minted for: its user id, or `null` for a
 * caller with no account.
 */
export type SurfaceTokenViewer = string | null;

/**
 * Cache of sync-service connection tokens per viewer and surface id. Mirrors
 * the block permission-token store (`@core/signal/token`): tokens are reused
 * until 60s before expiry, then re-minted. A token names the caller it was
 * minted for and carries that caller's access, so one viewer's token never
 * serves another, signing in or out included.
 */
const surfaceTokenCache = new Map<string, Token>();

const cacheKey = (viewer: SurfaceTokenViewer, surfaceId: string) =>
  `${viewer ?? ''}@${surfaceId}`;

/** The user a token was minted for, from its `user_id` claim. */
function tokenViewer(token: Token): SurfaceTokenViewer | undefined {
  try {
    const payload: { user_id?: string } = JSON.parse(atob(token.split('.')[1]));
    return payload.user_id ?? null;
  } catch {
    return undefined;
  }
}

/**
 * A valid connection token for `viewer` on the surface, from cache or freshly
 * minted via `POST /collab_surfaces/{id}/token`. `absent` means the surface
 * does not exist or is not ready; `failed` covers no access, a deleted
 * surface, and network errors.
 */
export async function mintCollabSurfaceToken(
  surfaceId: string,
  viewer: SurfaceTokenViewer
): Promise<{ token: Token } | { error: 'absent' | 'failed' }> {
  const key = cacheKey(viewer, surfaceId);
  const cached = surfaceTokenCache.get(key);
  if (cached && !isTokenExpired(cached)) {
    return { token: cached };
  }

  const response = await storageServiceClient.collabSurfaces.createToken({
    id: surfaceId,
  });
  if (response.isErr()) {
    const absent = response.error.some(
      (error) => error.code === 'NOT_FOUND' || error.code === 'CONFLICT'
    );
    if (!absent)
      console.error('failed to mint collab surface token', response.error);
    return { error: absent ? 'absent' : 'failed' };
  }

  const token = response.value.token;
  // The session may have changed since the caller looked: cache only a token
  // minted for the viewer it was asked for.
  if (tokenViewer(token) === viewer) surfaceTokenCache.set(key, token);
  return { token };
}

/**
 * A valid connection token for `viewer` on the surface, or undefined when
 * minting fails (no access, deleted surface, network error).
 */
export async function getCollabSurfaceToken(
  surfaceId: string,
  viewer: SurfaceTokenViewer
): Promise<Token | undefined> {
  const minted = await mintCollabSurfaceToken(surfaceId, viewer);
  return 'token' in minted ? minted.token : undefined;
}
