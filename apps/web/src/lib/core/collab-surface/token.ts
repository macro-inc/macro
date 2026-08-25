import { isTokenExpired } from '@core/signal/token';
import { storageServiceClient } from '@service-storage/client';

type Token = string;

/**
 * Cache of sync-service connection tokens per surface id. Mirrors the block
 * permission-token store (`@core/signal/token`): tokens are reused until 60s
 * before expiry, then re-minted.
 */
const surfaceTokenCache = new Map<string, Token>();

/**
 * A valid sync-service connection token for the surface, from cache or freshly
 * minted via `POST /collab_surfaces/{id}/token`. Undefined when minting fails
 * (no access, deleted surface, network error).
 */
export async function getCollabSurfaceToken(
  surfaceId: string
): Promise<string | undefined> {
  const cached = surfaceTokenCache.get(surfaceId);
  if (cached && !isTokenExpired(cached)) {
    return cached;
  }

  const response = await storageServiceClient.collabSurfaces.createToken({
    id: surfaceId,
  });
  if (response.isErr()) {
    console.error('failed to mint collab surface token', response.error);
    return undefined;
  }

  surfaceTokenCache.set(surfaceId, response.value.token);
  return response.value.token;
}
