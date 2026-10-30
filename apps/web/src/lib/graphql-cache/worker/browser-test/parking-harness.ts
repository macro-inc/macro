import { subscribeToVisibleCacheChanges } from '@queries/subscribe-to-visible-cache-changes';
import {
  NotificationUpdatesDocument,
  type NotificationUpdatesSubscription,
} from '@service-storage/graphql/generated/graphql';
import { notificationReceiptExchange } from '@service-storage/graphql-notification-receipt';
import {
  createClient,
  fetchExchange,
  gql,
  stringifyDocument,
  subscriptionExchange,
} from '@urql/core';
import { createRoot } from 'solid-js';
import { normalizedCacheExchange } from '../../exchange/normalized-cache-exchange';
import type { CacheHost } from '../../host/types';
import { createWorkerCacheHost } from '../../host/worker-host';

const params = new URLSearchParams(location.search);
const scope = params.get('scope');
if (!scope?.startsWith('cache-parking-'))
  throw new Error('synthetic scope required');
const nativeWorker = globalThis.Worker;
const parked = Promise.withResolvers<void>();
const epochs: number[] = [];
globalThis.Worker = new Proxy(nativeWorker, {
  construct(_target, args: ConstructorParameters<typeof Worker>) {
    const worker = new nativeWorker(...args);
    if (args[1]?.name?.startsWith('graphql-cache-engine:')) {
      epochs.push(Number(args[1].name.split(':').at(-1)));
      const terminate = worker.terminate.bind(worker);
      worker.terminate = () => {
        terminate();
        parked.resolve();
      };
    }
    return worker;
  },
});
const query = 'query ParkingWitness { user { id } }';
const data = { user: { id: 'macro|parking-fixture' } };
const mutation = gql`mutation ParkingMutation($input: SetEntityPropertyInput!) {
  setEntityProperty(input: $input) { id displayName }
}`;
const variables = (uuid: string) => ({
  input: {
    entityType: 'DOCUMENT',
    entityId: 'synthetic-document',
    propertyDefinitionId: uuid,
    value: { string: 'synthetic' },
  },
});
let host: CacheHost | undefined;
let apiRequests = 0;
let generationBefore: string | undefined;
let seedUuid: string | undefined;
const response = Promise.withResolvers<Response>();
const sent = Promise.withResolvers<void>();
const settling = Promise.withResolvers<void>();
let result: Promise<unknown> | undefined;
let readResult: Promise<{ data: unknown; error: boolean }> | undefined;
let readApiRequests = 0;
const receivedNotifications: string[] = [];
const persistedNotifications: string[] = [];
const notificationPersisted = Promise.withResolvers<void>();
let emitNotification: (() => void) | undefined;
let stopNotifications: (() => void) | undefined;
const catchupQuery = 'query Catchup { user { id } }';
const catchupRefreshed = Promise.withResolvers<void>();
const catchupRevisions: string[] = [];
const catchupBatches: number[] = [];
const catchupBatchReported = Promise.withResolvers<void>();
let catchupRefreshes = 0;
let catchupRead: unknown;
let catchupWrites: Promise<unknown> | undefined;
let stopCatchup: (() => void) | undefined;
function requireHost(): CacheHost {
  if (!host) throw new Error('cache not started');
  return host;
}
const api = {
  async start(seed = false) {
    host ??= createWorkerCacheHost({
      scope,
      telemetrySink: {
        emit(event) {
          if (event.name !== 'graphql_cache.change_batch') return;
          catchupBatches.push(event.count ?? 0);
          catchupBatchReported.resolve();
        },
      },
    });
    if (seed) {
      await host.writeQuery({ query, data });
      seedUuid = crypto.randomUUID();
      const now = Date.now();
      await host.enqueueOptimisticMutation(
        {
          uuid: seedUuid,
          query: stringifyDocument(mutation),
          variables: variables(seedUuid),
          data: { setEntityProperty: { id: seedUuid, displayName: 'Queued' } },
        },
        {
          owner: 'parking-seed',
          nowMs: now,
          leaseExpiresAtMs: now + 86_400_000,
        }
      );
    }
    generationBefore ??= await host.currentStorageGeneration();
    return generationBefore;
  },
  async snapshot() {
    const current = requireHost();
    return {
      clientId: current.clientId,
      generation: await current.currentStorageGeneration(),
      queue: await current.inspectMutations?.(),
      read: await current.readQuery({ query }),
      generationBefore,
      seedUuid,
      epochs: [...epochs],
      apiRequests,
      readApiRequests,
      visibility: document.visibilityState,
    };
  },
  queueCatchup() {
    const current = requireHost();
    stopCatchup = createRoot((dispose) => {
      const unsubscribe = current.onCacheChanged((revision) => {
        catchupRevisions.push(revision);
      });
      const stopRefresh = subscribeToVisibleCacheChanges(current, async () => {
        catchupRefreshes += 1;
        catchupRead = await current.readQuery({ query: catchupQuery });
        catchupRefreshed.resolve();
      });
      return () => {
        unsubscribe();
        stopRefresh();
        dispose();
      };
    });
    catchupWrites = Promise.all([
      ...[
        'SoupUpdates',
        'ChannelUnreadPresence',
        'CalendarChanges',
        'Calendars',
      ].map((name, index) =>
        current.writeQuery({
          query: `query ${name} { user { id } }`,
          data: { user: { id: `catchup-${index}` } },
        })
      ),
      current.calendarCommit({
        coverage: [{ kind: 'timed', start: 0, end: 1 }],
        freshness: 'fresh',
      }),
    ]);
  },
  async catchupDone() {
    await catchupWrites;
    await catchupRefreshed.promise;
    await catchupBatchReported.promise;
  },
  catchupSnapshot: () => ({
    revisions: [...catchupRevisions],
    batches: [...catchupBatches],
    refreshes: catchupRefreshes,
    read: catchupRead,
  }),
  async startNotifications() {
    const attached = Promise.withResolvers<void>();
    const client = createClient({
      url: 'https://parking.invalid/graphql',
      exchanges: [
        normalizedCacheExchange(requireHost()),
        notificationReceiptExchange((patch) => {
          if (patch.__typename === 'GraphqlNewNotification')
            receivedNotifications.push(patch.notification.id);
        }),
        subscriptionExchange({
          forwardSubscription: () => ({
            subscribe(sink) {
              emitNotification = () => {
                const data: NotificationUpdatesSubscription = {
                  notificationUpdates: {
                    __typename: 'GraphqlNewNotification',
                    notification: {
                      __typename: 'GraphqlNotification',
                      id: 'synthetic-notification',
                      entityId: 'synthetic-reminder',
                      entityType: 'DOCUMENT',
                      targetEntityType: 'REMINDER',
                      eventType: 'reminder',
                      state: 'UNSEEN',
                      sent: true,
                      createdAt: '2026-01-01T00:00:00Z',
                      updatedAt: '2026-01-01T00:00:00Z',
                      viewedAt: null,
                      senderId: null,
                      metadata: {
                        __typename: 'GraphqlReminderMetadata',
                        reminderReminderId: 'synthetic-reminder',
                        reminderDescription: 'Review the document',
                        reminderScheduledFor: null,
                      },
                    },
                  },
                };
                sink.next({ data });
              };
              attached.resolve();
              return { unsubscribe() {} };
            },
          }),
        }),
      ],
    });
    const subscription = client
      .subscription(NotificationUpdatesDocument, {})
      .subscribe((result) => {
        const patch = result.data?.notificationUpdates;
        if (patch?.__typename !== 'GraphqlNewNotification') return;
        persistedNotifications.push(patch.notification.id);
        notificationPersisted.resolve();
      });
    stopNotifications = () => subscription.unsubscribe();
    await attached.promise;
  },
  emitNotification() {
    if (!emitNotification) throw new Error('notifications not started');
    emitNotification();
  },
  notifications: () => ({
    received: [...receivedNotifications],
    persisted: [...persistedNotifications],
  }),
  notificationPersisted: () => notificationPersisted.promise,
  parked: () => parked.promise,
  async locks() {
    return (await navigator.locks.query()).held?.filter((lock) =>
      lock.name?.includes(scope)
    );
  },
  async beginRead() {
    const current = requireHost();
    const watchQuery = current.watchQuery;
    if (!watchQuery) throw new Error('worker query watches unavailable');
    const started = Promise.withResolvers<void>();
    const client = createClient({
      url: 'https://parking.invalid/graphql',
      fetch: async () => {
        readApiRequests += 1;
        return new Response(JSON.stringify({ data }), {
          headers: { 'content-type': 'application/json' },
        });
      },
      exchanges: [
        normalizedCacheExchange({
          ...current,
          async watchQuery(args) {
            const pending = watchQuery(args);
            started.resolve();
            return await pending;
          },
        }),
        fetchExchange,
      ],
    });
    readResult = client
      .query(query, {})
      .toPromise()
      .then((result) => ({
        data: result.data,
        error: !!result.error,
      }));
    await started.promise;
  },
  readResult: () => readResult,
  async beginMutation() {
    const current = requireHost();
    await current.writeQuery({ query, data });
    generationBefore = await current.currentStorageGeneration();
    const uuid = crypto.randomUUID();
    const client = createClient({
      url: 'https://parking.invalid/graphql',
      fetch: async () => {
        apiRequests += 1;
        sent.resolve();
        return await response.promise;
      },
      exchanges: [
        normalizedCacheExchange({
          ...current,
          async commitOptimisticWrite(...args) {
            const committed = current.commitOptimisticWrite(...args);
            settling.resolve();
            return await committed;
          },
        }),
        fetchExchange,
      ],
    });
    result = client
      .mutation(mutation, variables(uuid), {
        normalizedCacheOptimistic: {
          uuid,
          optimisticResponse: {
            setEntityProperty: { id: uuid, displayName: 'Optimistic' },
          },
        },
      })
      .toPromise();
    await sent.promise;
    return uuid;
  },
  async reply(uuid: string) {
    response.resolve(
      new Response(
        JSON.stringify({
          data: {
            setEntityProperty: { id: uuid, displayName: 'Confirmed' },
          },
        }),
        { headers: { 'content-type': 'application/json' } }
      )
    );
    await settling.promise;
  },
  result: () => result,
  async competingClaim() {
    return await requireHost().claimNextMutation(
      'parking-competitor',
      Date.now() + 600_000,
      Date.now() + 900_000
    );
  },
  dispose() {
    stopCatchup?.();
    stopNotifications?.();
    host?.dispose();
  },
};
declare global {
  interface Window {
    cacheParkingHarness: typeof api;
  }
}
window.cacheParkingHarness = api;
document.querySelector('#result')?.setAttribute('data-status', 'ready');
