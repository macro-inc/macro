import { normalizedCacheExchange } from '@graphql-cache/exchange/normalized-cache-exchange';
import { createNoopCacheHost } from '@graphql-cache/host/noop-host';
import type { CacheHost } from '@graphql-cache/host/types';
import { type Span, Telemetry } from '@macro-inc/observability';
import {
  createClient,
  type Exchange,
  type OperationResult,
  subscriptionExchange,
} from '@urql/core';
import { afterEach, expect, it, vi } from 'vitest';
import {
  NotificationUpdatesDocument,
  type NotificationUpdatesSubscription,
} from './graphql/generated/graphql';
import { notificationReceiptExchange } from './graphql-notification-receipt';
import type { GraphqlNotificationPatch } from './graphql-soup-websocket';

const NEW_NOTIFICATION: GraphqlNotificationPatch = {
  __typename: 'GraphqlNewNotification',
  notification: {
    __typename: 'GraphqlNotification',
    id: 'notification-1',
    entityId: 'reminder-1',
    entityType: 'REMINDER',
    eventType: 'reminder',
    sent: true,
    state: 'UNSEEN',
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    viewedAt: null,
    senderId: null,
    metadata: {
      __typename: 'GraphqlReminderMetadata',
      reminderReminderId: 'reminder-1',
      reminderDescription: 'Review the document',
      reminderScheduledFor: null,
    },
  },
};
const DELETION: GraphqlNotificationPatch = {
  __typename: 'GraphqlCacheDeletion',
  graphqlTypeName: 'GraphqlNotification',
  entityId: 'notification-1',
};

class RecordedSpan implements Span {
  readonly children: RecordedSpan[] = [];
  readonly attributes: Record<string, unknown> = {};
  readonly errors: unknown[] = [];
  ends = 0;

  constructor(readonly name: string) {}
  span(name: string): Span;
  span<T>(name: string, operation: (span: Span) => Promise<T>): Promise<T>;
  span<T>(
    name: string,
    operation?: (span: Span) => Promise<T>
  ): Span | Promise<T> {
    const child = new RecordedSpan(name);
    this.children.push(child);
    if (!operation) return child;
    return child.run(async () => {
      try {
        return await operation(child);
      } finally {
        child.end();
      }
    });
  }
  run<T>(operation: () => T): T {
    return operation();
  }
  setAttr(name: string, value: unknown) {
    this.attributes[name] = value;
  }
  event() {}
  error(error: unknown) {
    this.errors.push(error);
  }
  traceparent() {
    return undefined;
  }
  injectTraceHeaders() {}
  end() {
    this.ends += 1;
  }
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

function subscribe(
  exchanges: Exchange[],
  onResult: (result: OperationResult<NotificationUpdatesSubscription>) => void
) {
  let receive: (result: { data: NotificationUpdatesSubscription }) => void =
    () => {
      throw new Error('subscription is not attached');
    };
  const attached = Promise.withResolvers<void>();
  const unsubscribe = vi.fn();
  const client = createClient({
    url: 'https://notification.test/graphql',
    exchanges: [
      ...exchanges,
      subscriptionExchange({
        forwardSubscription: () => ({
          subscribe(sink) {
            receive = (result) => sink.next(result);
            attached.resolve();
            return { unsubscribe };
          },
        }),
      }),
    ],
  });
  const subscription = client
    .subscription(NotificationUpdatesDocument, {})
    .subscribe(onResult);
  return {
    attached: attached.promise,
    emit: (patch: GraphqlNotificationPatch) =>
      receive({ data: { notificationUpdates: patch } }),
    dispose: () => subscription.unsubscribe(),
    unsubscribe,
  };
}

it('delivers hidden-tab events before parked writes, preserving cache order without replaying alerts', async () => {
  vi.useFakeTimers();
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
  const first = new RecordedSpan('first receipt');
  const second = new RecordedSpan('second receipt');
  vi.spyOn(Telemetry, 'span')
    .mockReturnValueOnce(first)
    .mockReturnValueOnce(second);
  const resume = Promise.withResolvers<void>();
  const writeStarted = Promise.withResolvers<void>();
  const caughtUp = Promise.withResolvers<void>();
  const noop = createNoopCacheHost();
  const host: CacheHost = {
    ...noop,
    disabled: false,
    writeQuery: vi.fn(async (args) => {
      writeStarted.resolve();
      await resume.promise;
      return await noop.writeQuery(args);
    }),
    deleteRecords: vi.fn(noop.deleteRecords),
  };
  const onPatch = vi.fn();
  const onResult = vi.fn(
    (result: OperationResult<NotificationUpdatesSubscription>) => {
      if (
        result.data?.notificationUpdates.__typename === 'GraphqlCacheDeletion'
      )
        caughtUp.resolve();
    }
  );
  const stream = subscribe(
    [normalizedCacheExchange(host), notificationReceiptExchange(onPatch)],
    onResult
  );
  try {
    await stream.attached;
    stream.emit(NEW_NOTIFICATION);
    await writeStarted.promise;
    stream.emit(DELETION);
    expect(onPatch.mock.calls.map(([patch]) => patch)).toEqual([
      NEW_NOTIFICATION,
      DELETION,
    ]);
    expect(onResult).not.toHaveBeenCalled();
    expect(host.deleteRecords).not.toHaveBeenCalled();
    expect(first.ends).toBe(1);
    expect(first.children.map((span) => [span.name, span.ends])).toEqual([
      ['graphql.subscription.cache_queue', 1],
      ['graphql.subscription.cache_apply', 0],
    ]);
    expect(second.ends).toBe(1);
    expect(second.children.map((span) => [span.name, span.ends])).toEqual([
      ['graphql.subscription.cache_queue', 0],
    ]);

    resume.resolve();
    await caughtUp.promise;
    expect(host.writeQuery).toHaveBeenCalledOnce();
    expect(host.deleteRecords).toHaveBeenCalledExactlyOnceWith([
      'GraphqlNotification:notification-1',
    ]);
    expect(onResult).toHaveBeenCalledTimes(2);
    expect(onPatch).toHaveBeenCalledTimes(2);
    for (const receipt of [first, second]) {
      expect(receipt.children.map((span) => [span.name, span.ends])).toEqual([
        ['graphql.subscription.cache_queue', 1],
        ['graphql.subscription.cache_apply', 1],
      ]);
      expect(receipt.children[1].attributes['cache.effects_applied']).toBe(
        true
      );
      expect(receipt.children.flatMap((span) => span.errors)).toEqual([]);
      expect(JSON.stringify(receipt)).not.toContain('Review the document');
    }
  } finally {
    stream.dispose();
    host.dispose();
  }
});

it('does not let a notification callback failure stop persistence or the next event', async () => {
  vi.useFakeTimers();
  const error = new Error('notification callback failed');
  const report = vi.spyOn(Telemetry, 'error').mockImplementation(() => {});
  const onPatch = vi.fn().mockImplementationOnce(() => {
    throw error;
  });
  const caughtUp = Promise.withResolvers<void>();
  const noop = createNoopCacheHost();
  const host: CacheHost = {
    ...noop,
    writeQuery: vi.fn(noop.writeQuery),
    deleteRecords: vi.fn(noop.deleteRecords),
  };
  const stream = subscribe(
    [normalizedCacheExchange(host), notificationReceiptExchange(onPatch)],
    (result) => {
      if (
        result.data?.notificationUpdates.__typename === 'GraphqlCacheDeletion'
      )
        caughtUp.resolve();
    }
  );
  try {
    await stream.attached;
    stream.emit(NEW_NOTIFICATION);
    stream.emit(DELETION);
    await caughtUp.promise;
    expect(report).toHaveBeenCalledWith(error, {
      surface: 'graphql-notifications',
    });
    expect(onPatch).toHaveBeenCalledTimes(2);
    expect(host.writeQuery).toHaveBeenCalledOnce();
    expect(host.deleteRecords).toHaveBeenCalledOnce();
  } finally {
    stream.dispose();
  }
});

it('marks failed persistence in the receipt trace without failing or replaying delivery', async () => {
  const receipt = new RecordedSpan('receipt');
  vi.spyOn(Telemetry, 'span').mockReturnValueOnce(receipt);
  const failure = new Error('private cache failure details');
  const onCacheError = vi.fn();
  const delivered = Promise.withResolvers<void>();
  const onPatch = vi.fn();
  const stream = subscribe(
    [
      normalizedCacheExchange(
        {
          ...createNoopCacheHost(),
          async writeQuery() {
            throw failure;
          },
        },
        { onCacheError }
      ),
      notificationReceiptExchange(onPatch),
    ],
    () => delivered.resolve()
  );
  try {
    await stream.attached;
    stream.emit(NEW_NOTIFICATION);
    await delivered.promise;
    expect(onPatch).toHaveBeenCalledOnce();
    expect(onCacheError).toHaveBeenCalledWith(failure, expect.any(Object));
    expect(receipt.ends).toBe(1);
    expect(receipt.errors).toEqual([]);
    expect(receipt.children.map((span) => span.ends)).toEqual([1, 1]);
    expect(receipt.children[1].errors).toEqual([
      'Subscription cache effect failed',
    ]);
    expect(receipt.children[1].attributes['cache.effects_applied']).toBe(false);
    expect(JSON.stringify(receipt)).not.toContain(failure.message);
  } finally {
    stream.dispose();
  }
});

it('delivers without a cache and stops receipt when the subscription is disposed', async () => {
  const onPatch = vi.fn();
  const stream = subscribe([notificationReceiptExchange(onPatch)], vi.fn());
  await stream.attached;
  stream.emit(NEW_NOTIFICATION);
  expect(onPatch).toHaveBeenCalledExactlyOnceWith(
    NEW_NOTIFICATION,
    expect.objectContaining({ error: expect.any(Function) })
  );
  stream.dispose();
  expect(stream.unsubscribe).toHaveBeenCalledOnce();
  stream.emit(DELETION);
  expect(onPatch).toHaveBeenCalledOnce();
});
