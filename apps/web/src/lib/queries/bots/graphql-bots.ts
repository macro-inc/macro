import { createLiveQuery } from '@graphql-cache/solid/create-live-query';
import {
  type BotFieldsFragment,
  BotIdentitiesDocument,
  MentionableBotsDocument,
} from '@service-storage/graphql/generated/graphql';
import { getGraphqlSoupClient } from '@service-storage/graphql-soup';
import type { Client } from '@urql/core';
import {
  type Accessor,
  createComputed,
  createMemo,
  createRoot,
  createSignal,
  mapArray,
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

/**
 * Bots pushed to a client. `shown` means mounted reads already show them: the
 * normalized cache applied the push, or (without the websocket) the gateway
 * bridge holds them.
 */
export type BotPush = {
  bots: readonly Pick<BotFieldsFragment, 'id' | 'deletedAt'>[];
  shown: boolean;
};

type Revalidator = {
  client: () => Client;
  /** Whether a push changes what this read returns. */
  affected: (push: BotPush) => boolean;
  refresh: () => Promise<unknown>;
};
const revalidators = new Set<Revalidator>();

/**
 * Refetch the mounted bot reads on `client` that `push` changes, or all of
 * them when `push` is null (pushes may have been missed).
 */
export async function revalidateBotReads(
  client: Pick<Client, 'query'>,
  push: BotPush | null
): Promise<void> {
  await Promise.all(
    [...revalidators].map(async (entry) => {
      if (entry.client() !== client) return;
      if (push && !entry.affected(push)) return;
      try {
        await entry.refresh();
      } catch (error) {
        console.warn('Bot read revalidation failed', error);
      }
    })
  );
}

function registerRevalidator(
  client: () => Client,
  affected: Revalidator['affected'],
  refetch: () => Promise<unknown>
) {
  let disposed = false;
  const revalidator: Revalidator = {
    client,
    affected,
    refresh: createTrailingRefetch(() => !disposed, refetch),
  };
  revalidators.add(revalidator);
  onCleanup(() => {
    disposed = true;
    revalidators.delete(revalidator);
  });
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
    // A push the cache applied already shows; otherwise read the bots again.
    registerRevalidator(
      () => client,
      (push) => !push.shown && push.bots.some((bot) => ids.includes(bot.id)),
      () => query.refetch({ requestPolicy: 'network-only' })
    );
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

function fromRecord(bot: BotFieldsFragment): BotIdentity {
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

/** A read bot, under the gateway bridge's newer profile when it has one. */
function toIdentity(bot: BotFieldsFragment): BotIdentity {
  const pushed = gatewayBotProfile(bot.id);
  return pushed ? withPushed(bot, pushed) : fromRecord(bot);
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
    if (found) return fromRecord(found);
    if (query?.data && !query.isFetching) return null;
    return fromSeed();
  };

  return {
    data,
    /** The read failed and nothing is known about the bot. */
    isError: () => Boolean(batch()?.error) && data() === undefined,
  };
}

/**
 * Identities for many bot ids, each read as `createBotIdentity` reads one;
 * for a list whose membership comes from elsewhere (REST, config).
 */
export function createBotIdentities(ids: Accessor<readonly string[]>) {
  const readers = mapArray(
    () => [...new Set(ids())],
    (id) => ({ id, reader: createBotIdentity(() => id) })
  );
  const byId = createMemo(() =>
    Object.fromEntries(readers().map(({ id, reader }) => [id, reader]))
  );
  return (id: string): BotIdentity | null | undefined => byId()[id]?.data();
}

/**
 * The bots the viewer can `@` mention, live. `channelId` scopes it to a
 * channel's bots plus agents available everywhere; null means every agent the
 * viewer can start; undefined reads nothing. A rename or new picture
 * re-renders from the cache; a pushed bot this list lacks, or a deletion,
 * reads the list again.
 */
export function createMentionableBots(
  channelId: Accessor<string | null | undefined>
) {
  const query = createLiveQuery(
    MentionableBotsDocument,
    () => {
      const scope = channelId();
      return scope === undefined ? undefined : { channelId: scope };
    },
    () => ({
      client: getGraphqlSoupClient(),
      requestPolicy: 'cache-and-network',
    })
  );
  const listed = () => query.data?.user.mentionableBots ?? [];
  registerRevalidator(
    getGraphqlSoupClient,
    (push) =>
      push.bots.some((bot) => {
        const present = listed().some((row) => row.id === bot.id);
        return bot.deletedAt != null || !present || !push.shown;
      }),
    () => query.refetch({ requestPolicy: 'network-only' })
  );
  return {
    bots: (): BotIdentity[] => listed().map(toIdentity),
    isPending: () => query.data === undefined && !query.error,
  };
}
