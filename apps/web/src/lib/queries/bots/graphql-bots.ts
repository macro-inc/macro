import { createLiveQuery } from '@graphql-cache/solid/create-live-query';
import {
  type BotFieldsFragment,
  BotIdentitiesDocument,
} from '@service-storage/graphql/generated/graphql';
import { getGraphqlSoupClient } from '@service-storage/graphql-soup';
import type { Client } from '@urql/core';
import {
  type Accessor,
  createComputed,
  createRoot,
  createSignal,
  onCleanup,
} from 'solid-js';
import { createLivePreviewBatcher } from '../preview/live-batcher';
import { createTrailingRefetch } from '../trailing-refetch';
import { isHexHyphenatedId } from './bot-id';

/** A bot's name, handle and picture as every view shows it. */
export type BotIdentity = {
  id: string;
  name: string;
  handle: string;
  avatarUrl: string | undefined;
  deleted: boolean;
  isSystem: boolean;
};

/** `user.bots` takes at most 100 ids. */
const MAX_BOT_IDS = 100;

type Revalidator = {
  client: Client;
  ids: readonly string[];
  refresh: () => Promise<unknown>;
};
const revalidators = new Set<Revalidator>();

/**
 * Refetch the mounted identity batches on `client` that hold any of `ids`,
 * or all of them when `ids` is null (pushes may have been missed).
 */
export async function revalidateBotIdentities(
  client: Pick<Client, 'query'>,
  ids: ReadonlySet<string> | null
): Promise<void> {
  await Promise.all(
    [...revalidators].map(async (entry) => {
      if (entry.client !== client) return;
      if (ids && !entry.ids.some((id) => ids.has(id))) return;
      try {
        await entry.refresh();
      } catch (error) {
        console.warn('Bot identity revalidation failed', error);
      }
    })
  );
}

function startBatch(client: Client, ids: string[]) {
  return createRoot((dispose) => {
    const query = createLiveQuery(
      BotIdentitiesDocument,
      () => ({ ids }),
      () => ({
        client,
        requestPolicy: 'cache-and-network',
        keepPreviousData: false,
      })
    );
    let disposed = false;
    const revalidator: Revalidator = {
      client,
      ids,
      refresh: createTrailingRefetch(
        () => !disposed,
        () => query.refetch({ requestPolicy: 'network-only' })
      ),
    };
    revalidators.add(revalidator);
    onCleanup(() => {
      disposed = true;
      revalidators.delete(revalidator);
    });
    return { value: query, dispose };
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
      maxSize: MAX_BOT_IDS,
    });
    batchers.set(client, value);
  }
  return value;
}

function toIdentity(bot: BotFieldsFragment): BotIdentity {
  return {
    id: bot.id,
    name: bot.name,
    handle: bot.handle,
    avatarUrl: bot.avatarUrl ?? undefined,
    deleted: bot.deletedAt != null,
    isSystem: bot.isSystem,
  };
}

/**
 * A bot's identity by bare id, as it is now. Mounted readers share batched
 * live `user.bots` reads, so a `botUpdates` push re-renders every one of them
 * without a request. `undefined` until known, `null` when no bot has the
 * id; once known, a revalidation keeps the answer until it settles. An empty
 * or malformed id reads nothing.
 */
export function createBotIdentity(botId: Accessor<string>) {
  const id = () => (isHexHyphenatedId(botId()) ? botId() : '');
  const [batch, setBatch] = createSignal<Batch>();
  createComputed(() => {
    setBatch(undefined);
    const current = id();
    if (!current) return;
    const owner = getGraphqlSoupClient();
    const subscription = batcher(owner).acquire(current, current, setBatch);
    onCleanup(subscription.dispose);
  });

  const data = (): BotIdentity | null | undefined => {
    const current = id();
    if (!current) return undefined;
    const query = batch();
    const found = query?.data?.user.bots.find((bot) => bot.id === current);
    if (found) return toIdentity(found);
    // The server answered without the bot; a later read in flight keeps it.
    if (query?.data && (query.isFetched || !query.isFetching)) return null;
    return undefined;
  };

  return {
    data,
    /** The read failed and nothing is known about the bot. */
    isError: () => Boolean(batch()?.error) && data() === undefined,
  };
}
