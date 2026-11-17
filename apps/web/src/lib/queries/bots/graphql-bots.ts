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
/**
 * How long a bot read nobody shows stays live, so a recycled row or a
 * reopened view shows the bot at once rather than reading it again.
 */
const RELEASED_BOT_LINGER_MS = 5 * 60_000;

/**
 * Bots pushed to a client. `shown` means mounted reads already show them:
 * the normalized cache applied the push.
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
  /** The channel a mentionable list is scoped to, if it is one. */
  channel?: () => string | null | undefined;
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
  refetch: () => Promise<unknown>,
  channel?: Revalidator['channel']
) {
  let disposed = false;
  const revalidator: Revalidator = {
    client,
    affected,
    refresh: createTrailingRefetch(() => !disposed, refetch),
    channel,
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
      linger: RELEASED_BOT_LINGER_MS,
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
 * viewer can start; undefined reads nothing. Names and pictures re-render
 * from the cache; every bot push, and an invite or removal in its channel
 * (`revalidateMentionableBots`), reads the list again.
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
  // Any push can change who belongs: a new bot, a deletion, or an agent
  // narrowed to selected channels, which is still the same bot. Pushes are
  // rare, so the list reads again for every one.
  registerRevalidator(
    getGraphqlSoupClient,
    () => true,
    () => query.refetch({ requestPolicy: 'network-only' }),
    channelId
  );
  return {
    bots: (): BotIdentity[] => listed().map(toIdentity),
    isPending: () => query.data === undefined && !query.error,
  };
}

/**
 * Read again the mounted mentionable lists of `channelIds`, after a bot
 * joined or left one of them: membership changes push no bot.
 */
export function revalidateMentionableBots(channelIds: readonly string[]) {
  const channels = new Set(channelIds);
  return Promise.all(
    [...revalidators].map(async (entry) => {
      const channel = entry.channel?.();
      if (!channel || !channels.has(channel)) return;
      try {
        await entry.refresh();
      } catch (error) {
        console.warn('Mentionable bots revalidation failed', error);
      }
    })
  );
}
