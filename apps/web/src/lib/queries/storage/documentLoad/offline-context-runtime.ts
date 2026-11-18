import { RUST_EDITOR_ENGINE } from '@core/document-session/engine-selection';
import { isNativeMobilePlatform } from '@core/mobile/isNativeMobilePlatform';
import { hasLoginCookie } from '@core/util/cookies';
import { authKeys } from '../../auth/keys';
import type { UserInfoData } from '../../auth/user-info';
import { queryClient } from '../../client';
import { createPerQueryIDBStore } from '../../persistence/per-query-idb';
import { createOfflineDocumentContextCache } from './offline-context-cache';

const EPOCH_KEY = 'document-open-context:epoch';
let persistenceAvailable = true;
let volatileEpoch = crypto.randomUUID();
let validatedEpoch: string | undefined;

type SessionEpoch = { epoch: string; durable: boolean };

function readSessionEpoch(): SessionEpoch {
  if (!persistenceAvailable) return { epoch: volatileEpoch, durable: false };
  try {
    const epoch = localStorage.getItem(EPOCH_KEY) ?? crypto.randomUUID();
    // Probe once per epoch, not on every editor/status callback.
    if (validatedEpoch !== epoch) {
      localStorage.setItem(EPOCH_KEY, epoch);
      validatedEpoch = epoch;
    }
    return { epoch, durable: true };
  } catch {
    // Keep source authorization session-bound even without durable storage.
    return { epoch: volatileEpoch, durable: false };
  }
}

/** Fence native loads that begin before user-info hydration supplies an identity. */
export function documentSessionEpoch(): string {
  return readSessionEpoch().epoch;
}

export const offlineDocumentContextCache = createOfflineDocumentContextCache({
  store: createPerQueryIDBStore({ dbName: 'native-document-open-persist-v1' }),
  identity: () => {
    const native = isNativeMobilePlatform();
    if ((!native && !RUST_EDITOR_ENGINE) || !hasLoginCookie()) return;
    const state = queryClient.getQueryState<UserInfoData>(
      authKeys.userInfo.queryKey
    );
    if (!state?.data?.authenticated || !state.data.id) return;
    const { epoch, durable } = readSessionEpoch();
    // A flag-off web logout finds web contexts by their recorded epoch, so
    // never store one without it. Native logout always clears.
    if (!native && !durable) return;
    return { userId: state.data.id, epoch };
  },
});

function hasPersistedEpoch(): boolean {
  try {
    return localStorage.getItem(EPOCH_KEY) !== null;
  } catch {
    // Unknown: clear rather than risk leaving another account's contexts.
    return true;
  }
}

/** Rotate before asynchronous clearing so late work cannot restore a logged-out session. */
export async function clearOfflineDocumentContexts(): Promise<void> {
  // Web writes this store only while the engine is on, and only under a
  // recorded epoch. A flag-off load still clears what an earlier flag-on load
  // left; a web origin that never wrote it keeps main's untouched storage.
  if (!isNativeMobilePlatform() && !RUST_EDITOR_ENGINE && !hasPersistedEpoch())
    return;
  volatileEpoch = crypto.randomUUID();
  try {
    localStorage.setItem(EPOCH_KEY, volatileEpoch);
  } catch {
    persistenceAvailable = false;
  }
  try {
    await offlineDocumentContextCache.clear();
  } catch {
    // The rotated epoch quarantines old entries even if IndexedDB cannot clear.
    console.error('Failed to clear offline document contexts');
  }
}

/** Notify sources when logout or an account change invalidates their captured identity. */
export function onDocumentSessionChange(listener: () => void): () => void {
  return queryClient.getQueryCache().subscribe((event) => {
    if (event.query.queryHash === JSON.stringify(authKeys.userInfo.queryKey))
      listener();
  });
}
