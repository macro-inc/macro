import { useBlockId } from '@core/block';
import { isErr } from '@core/util/maybeResult';
import { storageServiceClient } from '@service-storage/client';
import { createCallback } from '@solid-primitives/rootless';
import { createStore, type SetStoreFunction, type Store } from 'solid-js/store';

// 60 seconds
const EXPIRATION_THRESHOLD = 60;

type Token = string;
type TokenStore = Record<CompositeKey, Token>;
type CompositeKey = `${string}@${string}`;

const [sharedPermissionTokenStore, setSharedPermissionTokenStore] =
  createStore<TokenStore>({});

async function fetchNewToken(blockId: string) {
  const token =
    await storageServiceClient.permissionsTokens.createPermissionToken({
      document_id: blockId,
    });

  if (isErr(token)) {
    console.error('Failed to create permission token:', token);
    return;
  }

  return token[1].token;
}

function isTokenExpired(token: string) {
  try {
    const payload = JSON.parse(atob(token.split('.')[1]));
    const currentTime = Math.floor(Date.now() / 1000);
    return payload.exp < currentTime + EXPIRATION_THRESHOLD;
  } catch (_error) {
    return true;
  }
}

function makeCompositeKey(blockType: string, blockId: string): CompositeKey {
  return `${blockType}@${blockId}`;
}

/**
 * Fetches a permission token for the given block type and id.
 *
 * Tokens are cached in a store, and will automatically be refreshed if they are expired.
 *
 * By default the shared permission token store is used, but an optional store can be provided to use a different store.
 *
 * @param blockType The type of block to fetch the token for.
 * @param blockId The id of the block to fetch the token for.
 * @param store An optional store to use for storing the token. If not provided, the shared permission token store will be used.
 * @returns A callback that returns the token.
 */
export async function getPermissionToken(
  blockType: string,
  blockId: string,
  store?: [Store<TokenStore>, SetStoreFunction<TokenStore>]
) {
  const [tokenStore, setTokenStore] = store ?? [
    sharedPermissionTokenStore,
    setSharedPermissionTokenStore,
  ];
  const compositeKey = makeCompositeKey(blockType, blockId);

  const storedToken = tokenStore[compositeKey];

  if (!storedToken || isTokenExpired(storedToken)) {
    const token = await fetchNewToken(blockId);
    if (token) {
      setTokenStore(compositeKey, token);

      return token;
    } else {
      console.error('Failed to fetch permission token');
      return undefined;
    }
  }

  return storedToken;
}

export function useBlockPermissionToken() {
  const blockId = useBlockId();
  return createCallback(
    async () => await getPermissionToken('document', blockId)
  );
}
