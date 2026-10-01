import { scopeChannelNotificationsForEntity } from '@app/features/soup/entity-notifications';
import type { EntityData } from '@entity/types/entity';
import type { Notification } from '@entity/types/notification';
import { skipToken, useQuery } from '@tanstack/solid-query';
import type { Accessor } from 'solid-js';
import { queryClient } from '../../client';
import { refreshActiveGraphqlSoupQueries } from './active-queries';
import { graphqlSoupKeys } from './keys';

/** Retry reconciliation, or collect a settled intent with no mounted readers. */
export const GRAPHQL_SOUP_DONE_RETENTION_MS = 60_000;

export type PendingGraphqlSoupDone = {
  /** Stable across Done/Undo/Redo; query-local snapshots are weakly keyed by it. */
  operation: object;
  entityIds: ReadonlySet<string>;
  notificationIds: ReadonlySet<string>;
  done: boolean;
  startedAt: number;
  /** Redo is ID-scoped and must not dismiss notifications arriving after the initial action. */
  notificationStartedAt: number;
  scopeChannelThreads: boolean;
  /** Acknowledge raw query state, never the locally projected result. */
  observe: (reader: object, acknowledged: boolean) => void;
  unobserve: (reader: object) => void;
};

export type GraphqlSoupDoneOverlay = {
  release: () => void;
  /** Publish a new intent, retaining this operation's query-local undo snapshots. */
  setDone: (done: boolean) => void;
  /** The write succeeded (or was durably accepted); wait for cache acknowledgement. */
  settle: (notificationIds?: readonly string[]) => void;
};

const PENDING_DONE_KEY = graphqlSoupKeys.pendingDone.queryKey;

/** Immediate display state, independent of durable enqueue and list recomputation. */
export function hideGraphqlSoupEntitiesAsDone(args: {
  entityIds: readonly string[];
  notificationIds: readonly string[];
  scopeChannelThreads?: boolean;
  done?: boolean;
}): GraphqlSoupDoneOverlay {
  const operation = { id: crypto.randomUUID() };
  let current: PendingGraphqlSoupDone;
  let generation = 0;
  let active = false;
  let settled = false;
  let checking = false;
  let refreshing = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const readers = new Map<object, { version: number; acknowledged: boolean }>();

  const release = (acknowledged = false) => {
    if (!active) return;
    active = false;
    clearTimeout(timer);
    queryClient.setQueryData<PendingGraphqlSoupDone[]>(
      PENDING_DONE_KEY,
      (pending) => {
        const position =
          pending?.findIndex((entry) => entry.operation === operation) ?? -1;
        return pending?.flatMap((entry, index) => {
          if (entry.operation === operation) return [];
          if (!acknowledged || position < 0 || index > position) return [entry];
          // Once the newest intent is acknowledged, an older overlapping intent
          // must not become visible again merely because this layer is collected.
          const entityIds = new Set(
            [...entry.entityIds].filter((id) => !current.entityIds.has(id))
          );
          if (entityIds.size === entry.entityIds.size) return [entry];
          return entityIds.size > 0 ? [{ ...entry, entityIds }] : [];
        });
      }
    );
  };
  const check = () => {
    if (checking) return;
    checking = true;
    // Query projections must finish registering/acknowledging before changing
    // their input. Never write the query cache inside a derivation.
    queueMicrotask(() => {
      checking = false;
      if (
        active &&
        settled &&
        readers.size > 0 &&
        [...readers.values()].every((reader) => reader.acknowledged)
      ) {
        release(true);
      }
    });
  };
  const retry = async () => {
    const version = generation;
    if (!active) return;
    if (settled && readers.size === 0) {
      release(true);
      return;
    }
    // Keep cleanup independent of a hung refresh, without starting overlapping
    // network retries. A later tick can collect an intent whose readers unmounted.
    timer = setTimeout(() => void retry(), GRAPHQL_SOUP_DONE_RETENTION_MS);
    if (settled && !refreshing) {
      refreshing = true;
      try {
        await refreshActiveGraphqlSoupQueries({ throwOnError: true });
      } catch {
        // A failed/stale refresh must not resurrect rows. Mounted readers keep
        // their intent until they actually observe it, or the user reverses it.
      } finally {
        refreshing = false;
      }
    }
    if (version !== generation) return;
    check();
  };
  const observations = (
    version: number
  ): Pick<PendingGraphqlSoupDone, 'observe' | 'unobserve'> => ({
    observe: (reader, acknowledged) => {
      if (version !== generation || !active) return;
      readers.set(reader, { version, acknowledged });
      check();
    },
    unobserve: (reader) => {
      if (readers.get(reader)?.version !== version) return;
      readers.delete(reader);
      check();
    },
  });
  const publish = (done: boolean) => {
    clearTimeout(timer);
    const version = ++generation;
    const now = Date.now();
    active = true;
    settled = false;
    readers.clear();
    current = {
      operation,
      entityIds: new Set(args.entityIds),
      notificationIds: new Set(
        current?.notificationIds ?? args.notificationIds
      ),
      done,
      startedAt: now,
      notificationStartedAt: current?.notificationStartedAt ?? now,
      scopeChannelThreads: args.scopeChannelThreads ?? false,
      ...observations(version),
    };
    queryClient.setQueryData<PendingGraphqlSoupDone[]>(
      PENDING_DONE_KEY,
      (pending) => [
        ...(pending ?? []).filter((entry) => entry.operation !== operation),
        current,
      ]
    );
    timer = setTimeout(() => void retry(), GRAPHQL_SOUP_DONE_RETENTION_MS);
  };
  publish(args.done ?? true);

  return {
    release: () => release(),
    setDone: publish,
    settle: (notificationIds = []) => {
      if (!active) return;
      settled = true;
      if (notificationIds.some((id) => !current.notificationIds.has(id))) {
        // Re-evaluate acknowledgements against the exact changed rows, not just
        // the subset known when the optimistic action started.
        for (const [reader, state] of readers) {
          readers.set(reader, { ...state, acknowledged: false });
        }
        current = {
          ...current,
          ...observations(++generation),
          notificationIds: new Set([
            ...current.notificationIds,
            ...notificationIds,
          ]),
        };
        queryClient.setQueryData<PendingGraphqlSoupDone[]>(
          PENDING_DONE_KEY,
          (pending) =>
            pending?.map((entry) =>
              entry.operation === operation ? current : entry
            )
        );
      }
      check();
    },
  };
}

export function usePendingGraphqlSoupDone(): Accessor<
  readonly PendingGraphqlSoupDone[]
> {
  const pending = useQuery(
    () => ({
      queryKey: PENDING_DONE_KEY,
      queryFn: skipToken,
      initialData: [] as PendingGraphqlSoupDone[],
      gcTime: Infinity,
    }),
    () => queryClient
  );
  return () => (pending.isSuccess ? pending.data : []);
}

export function soupDoneNotifications(
  entity: EntityData,
  scopeChannelThreads: boolean
): Notification[] {
  const attached = (entity as { notifications?: unknown }).notifications;
  if (!Array.isArray(attached)) return [];
  const notifications = attached as Notification[];
  return scopeChannelThreads &&
    (entity.type === 'channel' || entity.type === 'channel_thread')
    ? scopeChannelNotificationsForEntity(entity, notifications)
    : notifications;
}

/** Only positively newer, in-scope activity may supersede Done. */
export function hasActivityAfterDone(
  entity: EntityData,
  intent: PendingGraphqlSoupDone
): boolean {
  return (
    intent.done &&
    soupDoneNotifications(entity, intent.scopeChannelThreads).some(
      ({ id, state, created_at }) =>
        state !== 'done' &&
        !intent.notificationIds.has(id) &&
        Date.parse(created_at) >
          (entity.type === 'email'
            ? intent.startedAt
            : intent.notificationStartedAt)
    )
  );
}

export function withPendingDoneIds(
  hiddenIds: ReadonlySet<string>,
  entities: readonly EntityData[],
  pending: readonly PendingGraphqlSoupDone[]
): ReadonlySet<string> {
  if (pending.length === 0) return hiddenIds;
  let hidden: Set<string> | undefined;
  for (const entity of entities) {
    const covering = pending.findLast(({ entityIds }) =>
      entityIds.has(entity.id)
    );
    if (!covering?.done || hasActivityAfterDone(entity, covering)) continue;
    hidden ??= new Set(hiddenIds);
    hidden.add(entity.id);
  }
  return hidden ?? hiddenIds;
}
