import { queryClient } from '../client';
import { emailKeys } from './keys';

// Saving a draft must not invalidate an active thread resource: doing so can
// detach its Suspense subtree and reset the editor and scroll position.
const savedThreads = new Set<string>();

export function markThreadDraftSaved(threadId: string) {
  savedThreads.add(threadId);
  // A save can settle after thread cleanup, or without mounting the thread.
  queryClient.removeQueries({
    queryKey: emailKeys.threadMessages(threadId).queryKey,
    type: 'inactive',
  });
}

export function clearSavedDraftThreadCache(threadId: string) {
  if (!savedThreads.delete(threadId)) return;
  queryClient.removeQueries({
    queryKey: emailKeys.threadMessages(threadId).queryKey,
  });
}
