import type { ServerPreparedBody } from '@app/features/email-message/context/email-rendering-context';
import { DEFAULT_THREAD_MESSAGES_LIMIT } from '@core/constant/pagination';
import { createLiveQuery } from '@graphql-cache/solid/create-live-query';
import {
  EmailThreadPreparedBodiesDocument,
  type EmailThreadPreparedBodiesQuery,
} from '@service-storage/graphql/generated/graphql';
import { getGraphqlSoupClient } from '@service-storage/graphql-soup';
import type { Accessor } from 'solid-js';

/** The server preparation version this client can mount. */
export const SERVER_PREPARE_VERSION = 1;

export function preparedBodiesById(
  data: EmailThreadPreparedBodiesQuery
): ReadonlyMap<string, ServerPreparedBody> {
  const bodies = new Map<string, ServerPreparedBody>();
  for (const message of data.user.emailThread?.messages ?? []) {
    const prepared = message.preparedBody;
    if (prepared?.version !== SERVER_PREPARE_VERSION) continue;
    bodies.set(message.id, {
      body: {
        html: prepared.html,
        kind: 'html',
        hasTable: prepared.hasTable,
        hasHiddenContent: prepared.hasHiddenContent,
      },
      imageProxyUrl: prepared.imageProxyUrl ?? null,
      sourceLength: prepared.sourceLength,
    });
  }
  return bodies;
}

/**
 * Server-prepared bodies for a thread's first page. A separate query from the
 * thread page, so a thread cached without them still opens from the cache.
 */
export function createPreparedBodiesQuery(
  threadId: Accessor<string>,
  enabled: Accessor<boolean>
): (messageId: string) => ServerPreparedBody | undefined {
  const query = createLiveQuery(
    EmailThreadPreparedBodiesDocument,
    () => ({
      threadId: threadId(),
      offset: 0,
      limit: DEFAULT_THREAD_MESSAGES_LIMIT,
      version: SERVER_PREPARE_VERSION,
    }),
    () => ({
      client: getGraphqlSoupClient(),
      enabled: enabled(),
      requestPolicy: 'cache-and-network' as const,
      select: preparedBodiesById,
    })
  );
  return (messageId) =>
    query.isSuccess ? query.data?.get(messageId) : undefined;
}
