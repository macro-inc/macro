import { createLiveQuery } from '@graphql-cache/solid/create-live-query';
import { AgentSessionMentionsDocument } from '@service-storage/graphql/generated/graphql';
import { getGraphqlSoupClient } from '@service-storage/graphql-soup';
import type { Client } from '@urql/core';
import {
  type Accessor,
  createComputed,
  createMemo,
  createRoot,
  createSignal,
  onCleanup,
} from 'solid-js';
import { registerActivityRevalidator } from '../activity/push-registry';
import { createQueryAuthorization } from '../authorization';
import { registerActiveGraphqlPreviewQuery } from '../preview/active-queries';
import { createLivePreviewBatcher } from '../preview/live-batcher';
import { createTrailingRefetch } from '../trailing-refetch';
import { agentSessionMentionInput } from './mention-fetchers';
import {
  type AgentSessionMentionPreview,
  normalizeAgentSessionStatus,
} from './mention-types';

function startBatch(client: Client, ids: string[]) {
  return createRoot((dispose) => {
    const authorization = createQueryAuthorization(() => 'batch');
    const query = createLiveQuery(
      AgentSessionMentionsDocument,
      () => ({ input: agentSessionMentionInput(ids) }),
      () => ({
        client,
        requestPolicy: 'cache-and-network',
        keepPreviousData: false,
        onResult: authorization.onResult,
      })
    );
    let disposed = false;
    const refresh = createTrailingRefetch(
      () => !disposed,
      () => query.refetch({ requestPolicy: 'cache-and-network' })
    );
    onCleanup(() => {
      disposed = true;
    });
    for (const id of ids)
      onCleanup(
        registerActiveGraphqlPreviewQuery({
          itemId: () => id,
          isEnabled: () => !disposed,
          refresh,
        })
      );
    onCleanup(
      registerActivityRevalidator({
        client: () => client,
        refresh: (entities) => {
          if (entities === null || ids.some((id) => entities.has(id)))
            return refresh();
        },
      })
    );
    return { value: { query, denied: authorization.error }, dispose };
  });
}

type Batch = ReturnType<typeof startBatch>['value'];
const batchers = new WeakMap<
  Client,
  ReturnType<typeof createLivePreviewBatcher<string, Batch>>
>();

function batcher(client: Client) {
  let value = batchers.get(client);
  if (!value) {
    value = createLivePreviewBatcher<string, Batch>({
      start: (ids) => startBatch(client, ids),
    });
    batchers.set(client, value);
  }
  return value;
}

/** Mounted mentions share live batches, including ownership and teardown. */
export function createGraphqlAgentSessionMentionPreview(
  id: Accessor<string>,
  enabled: Accessor<boolean>
) {
  const [query, setQuery] = createSignal<Batch>();
  createComputed(() => {
    setQuery(undefined);
    if (!enabled() || !id()) return;
    const subscription = batcher(getGraphqlSoupClient()).acquire(
      id(),
      id(),
      setQuery
    );
    onCleanup(subscription.dispose);
  });
  const data = createMemo<AgentSessionMentionPreview | undefined>(() => {
    const batch = query();
    const result = batch?.query;
    if (batch?.denied()) return undefined;
    if (result?.error?.graphQLErrors.length) return undefined;
    const item = result?.data?.user.soup.items.find((item) => item.id === id());
    return item?.__typename === 'GraphqlSoupAgentSession'
      ? {
          access: 'access',
          data: { ...item, status: normalizeAgentSessionStatus(item.status) },
        }
      : undefined;
  });
  return {
    data,
    shouldFallback: () =>
      enabled() &&
      !data() &&
      Boolean(query()?.query.isFetched && !query()?.query.isFetching),
  };
}
