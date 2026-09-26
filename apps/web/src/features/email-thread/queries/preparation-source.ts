import {
  enableGraphqlSoup,
  isFeatureEnabled,
} from '@core/constant/featureFlags';
import { DEFAULT_THREAD_MESSAGES_LIMIT } from '@core/constant/pagination';
import { retainGraphqlEmailThread } from '@queries/email/graphql/preload';
import {
  fetchAndCacheThread,
  readCachedEmailThread,
} from '@queries/email/thread';
import type { EmailThread } from '../core/email-thread';
import { toEmailThread } from './thread-source';

/** Hints use a complete local page before considering query-layer prefetch. */
export async function readThreadForPreparation(
  threadId: string,
  localOnly = false,
  retain?: (release: () => void) => void
): Promise<{ thread: EmailThread; hasMore: boolean } | undefined> {
  const retainLoadedSource = () => {
    if (retain && isFeatureEnabled(enableGraphqlSoup)) {
      // Join only after the normal source path has supplied a usable page.
      // A second cache-first request during a foreground miss can duplicate
      // its network fetch. Retention itself never needs another network read.
      retain(retainGraphqlEmailThread(threadId, true).release);
    }
  };
  try {
    const cached = await readCachedEmailThread(threadId);
    if (cached) {
      retainLoadedSource();
      return {
        thread: toEmailThread(cached.thread),
        hasMore: cached.hasMore,
      };
    }
    if (localOnly) return;
    const result = await fetchAndCacheThread(threadId);
    if (result.isErr()) return;
    retainLoadedSource();
    return {
      thread: toEmailThread(result.value.thread),
      hasMore:
        result.value.thread.messages.length >= DEFAULT_THREAD_MESSAGES_LIMIT,
    };
  } catch {
    /* Speculation is optional; the foreground query owns errors. */
  }
}
