import { DEFAULT_THREAD_MESSAGES_LIMIT } from '@core/constant/pagination';
import type { ApiThread } from '@service-email/generated/schemas';
import { EmailThreadPageDocument } from '@service-storage/graphql/generated/graphql';
import {
  getGraphqlSoupClient,
  graphqlCacheEnabled,
} from '@service-storage/graphql-soup';
import { pipe, subscribe } from 'wonka';
import { revokeCachedEmailThread } from '../cached-access';
import { mapGraphqlEmailThreadPage } from './mapper';

export interface EmailThreadPreload {
  ready: Promise<ApiThread | undefined>;
  release(): void;
}

// A navigation window retains at most five first pages. Larger pages may still
// prepare, but do not stay alive just to save a subsequent worker round trip.
const MAX_RETAINED_PAGE_BYTES = 1024 * 1024;

/** Keep urql's live result available synchronously until navigation releases it. */
export function retainGraphqlEmailThread(
  threadId: string,
  localOnly = false
): EmailThreadPreload {
  if (localOnly && !graphqlCacheEnabled())
    return { ready: Promise.resolve(undefined), release() {} };

  let settle: ((value: ApiThread | undefined) => void) | undefined;
  const ready = new Promise<ApiThread | undefined>((resolve) => {
    settle = resolve;
  });
  let released = false;
  let subscription: { unsubscribe(): void } | undefined;
  const release = () => {
    if (released) return;
    released = true;
    subscription?.unsubscribe();
    settle?.(undefined);
    settle = undefined;
  };
  try {
    subscription = pipe(
      getGraphqlSoupClient().query(
        EmailThreadPageDocument,
        { threadId, offset: 0, limit: DEFAULT_THREAD_MESSAGES_LIMIT },
        { requestPolicy: localOnly ? 'cache-only' : 'cache-first' }
      ),
      subscribe((result) => {
        if (released) return;
        try {
          const denied =
            result.error?.graphQLErrors.some((error) =>
              ['FORBIDDEN', 'UNAUTHORIZED', 'NOT_FOUND'].includes(
                String(error.extensions.code)
              )
            ) ||
            (result.data?.user.emailThread === null && !result.error);
          if (denied) {
            release();
            void revokeCachedEmailThread(threadId);
            return;
          }
          const thread = result.data?.user.emailThread;
          if (!thread) {
            if (!result.stale && !result.hasNext) release();
            return;
          }
          const bytes = thread.messages.reduce(
            (total, message) =>
              total +
              4096 +
              2 *
                ((message.bodyHtmlSanitized?.length ?? 0) +
                  (message.bodyReplyless?.length ?? 0) +
                  (message.bodyText?.length ?? 0) +
                  (message.bodyMacro?.length ?? 0)),
            4096
          );
          settle?.(mapGraphqlEmailThreadPage(thread));
          settle = undefined;
          if (bytes > MAX_RETAINED_PAGE_BYTES) release();
        } catch {
          // Partial or malformed responses must not break foreground queries.
          release();
        }
      })
    );
    // A complete result can be emitted synchronously during subscription.
    if (released) subscription.unsubscribe();
  } catch {
    release();
  }
  return { ready, release };
}
