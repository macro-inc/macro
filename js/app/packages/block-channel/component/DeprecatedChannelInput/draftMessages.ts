import type { DraftMessage } from '@core/store/cacheChannelInput';
import {
  cachedChannelInputStore,
  setCachedChannelInputStore,
} from '@core/store/cacheChannelInput';

export function getDraftKey(channelId: string, threadId?: string) {
  return threadId ? `${channelId}_${threadId}` : channelId;
}

// Debounced per-key save so we can cancel on clear to avoid races
const pendingSaves = new Map<string, ReturnType<typeof setTimeout>>();

function scheduleSave(
  draftKey: string,
  draft: Omit<DraftMessage, 'lastModified'>
) {
  const existing = pendingSaves.get(draftKey);
  if (existing) clearTimeout(existing);
  const handle = setTimeout(() => {
    setCachedChannelInputStore(draftKey, {
      ...draft,
      lastModified: Date.now(),
    });
    pendingSaves.delete(draftKey);
  }, 500);
  pendingSaves.set(draftKey, handle);
}

export function saveDraftMessage(
  channelId: string,
  draft: Omit<DraftMessage, 'lastModified'>
) {
  const draftKey = getDraftKey(channelId, draft.threadId);
  scheduleSave(draftKey, draft);
}

export function loadDraftMessage(
  channelId: string,
  threadId?: string
): DraftMessage | undefined {
  const draftKey = getDraftKey(channelId, threadId);
  return cachedChannelInputStore[draftKey];
}

export function clearDraftMessage(channelId: string, threadId?: string) {
  const draftKey = getDraftKey(channelId, threadId);
  const pending = pendingSaves.get(draftKey);
  if (pending) {
    clearTimeout(pending);
    pendingSaves.delete(draftKey);
  }
  setCachedChannelInputStore(draftKey, undefined);
}

export function checkHasDraft(channelId: string, threadId?: string): boolean {
  const draftKey = getDraftKey(channelId, threadId);
  return cachedChannelInputStore[draftKey] !== undefined;
}
