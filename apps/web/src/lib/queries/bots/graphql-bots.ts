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
import {
  type GatewayBotProfile,
  gatewayBotProfile,
} from './gateway-profile-bridge';

/** A bot's name, handle and picture as every view shows it. */
export type BotIdentity = {
  id: string;
  name: string;
  handle: string;
  avatarUrl: string | undefined;
  deleted: boolean;
  isSystem: boolean;
};

/** The copy of a bot's identity a payload (message, session) arrived with. */
export type BotIdentitySeed = { name: string; avatarUrl?: string | null };

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

/** A gateway profile over what the read returned; it lacks a handle. */
function withPushed(
  found: BotFieldsFragment | undefined,
  pushed: GatewayBotProfile
): BotIdentity {
  return {
    id: pushed.id,
    name: pushed.name,
    handle: found?.handle ?? '',
    avatarUrl: pushed.avatarUrl ?? undefined,
    deleted: pushed.deletedAt != null,
    isSystem: found?.isSystem ?? false,
  };
}

/**
 * A bot's identity by bare id, as it is now. Mounted readers share batched
 * live `user.bots` reads, so a `botUpdates` push re-renders every one of them
 * without a request. `undefined` until known (the `seed` stands in meanwhile),
 * `null` when no bot has the id. An empty or malformed id reads nothing.
 */
export function createBotIdentity(
  botId: Accessor<string>,
  seed?: Accessor<BotIdentitySeed | undefined>
) {
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

  const fromSeed = (): BotIdentity | undefined => {
    const copy = seed?.();
    if (!copy) return undefined;
    return {
      id: id(),
      name: copy.name,
      handle: '',
      avatarUrl: copy.avatarUrl ?? undefined,
      deleted: false,
      isSystem: false,
    };
  };

  const data = (): BotIdentity | null | undefined => {
    const current = id();
    if (!current) return undefined;
    const pushed = gatewayBotProfile(current);
    const query = batch();
    const found = query?.data?.user.bots.find((bot) => bot.id === current);
    if (pushed) return withPushed(found, pushed);
    if (found) return toIdentity(found);
    if (query?.data && !query.isFetching) return null;
    return fromSeed();
  };

  return {
    data,
    /** The read failed and nothing is known about the bot. */
    isError: () => Boolean(batch()?.error) && data() === undefined,
  };
}
