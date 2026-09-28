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

/** Fence native loads that begin before user-info hydration supplies an identity. */
export function documentSessionEpoch(): string {
  if (!persistenceAvailable) return volatileEpoch;
  try {
    const epoch = localStorage.getItem(EPOCH_KEY) ?? crypto.randomUUID();
    // Probe once per epoch, not on every editor/status callback.
    if (validatedEpoch !== epoch) {
      localStorage.setItem(EPOCH_KEY, epoch);
      validatedEpoch = epoch;
    }
    return epoch;
  } catch {
    // Keep source authorization session-bound even without durable storage.
    return volatileEpoch;
  }
}

export const offlineDocumentContextCache = createOfflineDocumentContextCache({
  store: createPerQueryIDBStore({ dbName: 'native-document-open-persist-v1' }),
  identity: () => {
    if (!isNativeMobilePlatform() || !hasLoginCookie()) return;
    const state = queryClient.getQueryState<UserInfoData>(
      authKeys.userInfo.queryKey
    );
    if (!state?.data?.authenticated || !state.data.id) return;
    return { userId: state.data.id, epoch: documentSessionEpoch() };
  },
});

/** Rotate before asynchronous clearing so late work cannot restore a logged-out session. */
export async function clearOfflineDocumentContexts(): Promise<void> {
  if (!isNativeMobilePlatform()) return;
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
