import { createUrqlQuery, type UrqlQueryResult } from '@app/lib/urql-solid';
import { fireAndForget } from '@core/util/fireAndForget';
import type { TypedDocumentNode } from '@graphql-typed-document-node/core';
import type { UnifiedNotification } from '@notifications/types';
import type { SoupInput } from '@service-storage/graphql/generated/graphql';
import {
  getGraphqlSoupClient,
  hasGraphqlCacheHost,
  subscribeGraphqlSoupReconnected,
} from '@service-storage/graphql-soup';
import {
  type GraphqlNotificationPatch,
  subscribeToGraphqlNotificationPatches,
} from '@service-storage/graphql-soup-websocket';
import {
  type Accessor,
  createEffect,
  createMemo,
  createRoot,
  createSignal,
  onCleanup,
  type Setter,
  untrack,
} from 'solid-js';
import { createHiddenDeferral } from '../../visible-refresh';
import { registerNotificationReader } from '../revalidation';

/** A live state change of a notification the user already has. */
export type NotificationUpdate = Extract<
  GraphqlNotificationPatch,
  { __typename: 'GraphqlUpdatedNotification' }
>['notification'];

type EntityEdgeVariables = { input: SoupInput };

/** One entity's notification edge, and how its deliveries change it. */
export type LiveNotificationQueryOptions<QueryData> = {
  /** The entity whose edge is read; deliveries for other entities are ignored. */
  entityId: string;
  query: TypedDocumentNode<QueryData, EntityEdgeVariables>;
  variables: EntityEdgeVariables;
  select: (data: QueryData) => UnifiedNotification[];
  enabled: Accessor<boolean>;
  /**
   * Whether an update of one of the entity's notifications changes which rows
   * the edge holds. A new notification, or the deletion of a held row, always
   * does; the normalized cache rewrites a held row's state in place.
   */
  updateChangesEdge: (
    update: NotificationUpdate,
    held: boolean,
    cacheMaintained: boolean
  ) => boolean;
  /** Reported with a failed read nobody awaits. */
  surface: string;
};

/**
 * A live, user-visible read of one entity's notification edge; never the
 * global feed. Notification writes the cache cannot keep current, deliveries
 * that change the edge and websocket reconnects read it again, one read at a
 * time. A signed-out session reads and listens for nothing.
 */
export function createLiveNotificationQuery<QueryData>(
  options: LiveNotificationQueryOptions<QueryData>
): UrqlQueryResult<UnifiedNotification[], EntityEdgeVariables, QueryData> {
  const query = createUrqlQuery(() => ({
    query: options.query,
    client: getGraphqlSoupClient(),
    variables: options.variables,
    enabled: options.enabled(),
    requestPolicy: 'cache-and-network',
    select: options.select,
  }));

  let disposed = false;
  let inFlight: Promise<void> | undefined;
  let queued = false;
  const read = async () => {
    let failure: { error: unknown } | undefined;
    do {
      queued = false;
      try {
        await query.refetch({
          requestPolicy: 'network-only',
          throwOnError: true,
        });
        // A later read supersedes an earlier failure.
        failure = undefined;
      } catch (error) {
        failure = { error };
      }
    } while (queued && !disposed);
    inFlight = undefined;
    if (failure) throw failure.error;
  };
  // A delivery during a read needs a read issued after it.
  const refresh = (): Promise<void> => {
    if (inFlight) {
      queued = true;
      return inFlight;
    }
    inFlight = read();
    return inFlight;
  };

  const changesEdge = (patch: GraphqlNotificationPatch) => {
    const held = (query.data ?? []).map(({ id }) => id);
    if (patch.__typename === 'GraphqlCacheDeletion') {
      return (
        patch.graphqlTypeName === 'GraphqlNotification' &&
        held.includes(patch.entityId)
      );
    }
    if (patch.notification.entityId !== options.entityId) return false;
    if (patch.__typename === 'GraphqlNewNotification') return true;
    return options.updateChangesEdge(
      patch.notification,
      held.includes(patch.notification.id),
      hasGraphqlCacheHost()
    );
  };

  const isEnabled = createMemo(options.enabled);
  createEffect(() => {
    if (!isEnabled()) return;
    onCleanup(
      registerNotificationReader({
        client: getGraphqlSoupClient,
        isEnabled: () => query.isEnabled,
        // Rows render each notification's cached state.
        cacheMaintained: hasGraphqlCacheHost,
        refresh,
      })
    );
    // Every open tab hears each delivery; a hidden one reads once on return.
    const background = createHiddenDeferral(() =>
      fireAndForget(refresh(), options.surface)
    );
    onCleanup(background.dispose);
    onCleanup(
      subscribeToGraphqlNotificationPatches((patch) => {
        if (changesEdge(patch)) background.request();
      })
    );
    // Deliveries missed while the socket was down.
    onCleanup(subscribeGraphqlSoupReconnected(background.request));
  });
  onCleanup(() => {
    disposed = true;
  });

  return query;
}

/**
 * How long a shared read outlives its last reader. A reader remounting soon
 * (a split change, a virtualized card scrolling back) reads the live query
 * instead of the network.
 */
const RELEASE_GRACE_MS = 30_000;

type SharedReadHolder = { enabled: Accessor<boolean> };
type SharedRead<Shared> = {
  value: Shared;
  holders: Accessor<readonly SharedReadHolder[]>;
  setHolders: Setter<readonly SharedReadHolder[]>;
  dispose: () => void;
  /** The last reader's holder, kept live while a quick remount may reuse it. */
  lingering?: {
    holder: SharedReadHolder;
    timer: ReturnType<typeof setTimeout>;
  };
};

/**
 * A registry of notification reads shared by key: one instance however many
 * readers show it, enabled while any of them may read, and ended a grace
 * period after the last one leaves.
 */
export function createSharedNotificationReads<Shared>() {
  const reads = new Map<string, SharedRead<Shared>>();
  return (
    key: string,
    enabled: Accessor<boolean>,
    create: (enabled: Accessor<boolean>) => Shared
  ): Shared => {
    let shared = reads.get(key);
    if (!shared) {
      // Under its own root, so the first reader to unmount does not end it.
      shared = createRoot((dispose) => {
        const [holders, setHolders] = createSignal<readonly SharedReadHolder[]>(
          []
        );
        const value = create(() =>
          holders().some((holder) => holder.enabled())
        );
        return { value, holders, setHolders, dispose };
      });
      reads.set(key, shared);
    }
    const entry = shared;
    const holder = { enabled };
    const lingering = entry.lingering;
    if (lingering) {
      clearTimeout(lingering.timer);
      entry.lingering = undefined;
    }
    entry.setHolders((holders) => [
      ...holders.filter((other) => other !== lingering?.holder),
      holder,
    ]);
    onCleanup(() => {
      const remaining = untrack(entry.holders).filter(
        (other) => other !== holder
      );
      if (remaining.length > 0) {
        entry.setHolders(remaining);
        return;
      }
      entry.lingering = {
        holder,
        timer: setTimeout(() => {
          entry.lingering = undefined;
          reads.delete(key);
          entry.dispose();
        }, RELEASE_GRACE_MS),
      };
    });
    return entry.value;
  };
}
