import { registerEntityActivityRevalidator } from '@queries/activity/push-registry';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ACTIVITY_PUSH_DEBOUNCE_MS,
  ACTIVITY_PUSH_JITTER_MS,
  createActivityUpdatesHandler,
} from './graphql-activity-updates';

/** Advances past the debounce plus the worst-case jitter. */
const MAX_FLUSH_DELAY_MS = ACTIVITY_PUSH_DEBOUNCE_MS + ACTIVITY_PUSH_JITTER_MS;

const DOC_ID = '11111111-1111-4111-8111-111111111111';
const OTHER_ID = '22222222-2222-4222-8222-222222222222';

function pushedEvent(entityId: string) {
  return {
    data: {
      activityUpdates: {
        __typename: 'GraphqlActivityEvent' as const,
        id: '33333333-3333-4333-8333-333333333333',
        actorId: 'macro|teo@example.com',
        subjectId: 'macro|teo@example.com',
        entityType: 'DOCUMENT' as const,
        entityId,
        occurredAt: '2026-08-15T00:00:00Z',
        action: { __typename: 'GraphqlActivityEdited' as const },
      },
    },
  } as never;
}

function fakeHost(variantsByOperation: Record<string, unknown[]>) {
  return {
    disabled: false,
    inspectQueryVariants: vi.fn(
      async ({ operationName }: { operationName: string }) =>
        variantsByOperation[operationName] ?? []
    ),
  } as never;
}

function fakeClient() {
  return {
    query: vi.fn(() => ({ toPromise: () => Promise.resolve({}) })),
  };
}

describe('createActivityUpdatesHandler', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('coalesces a burst into one page-0 refetch and one registry notification', async () => {
    const client = fakeClient();
    const host = fakeHost({
      MyActivity: [
        { variables: { input: { limit: 50, cursor: null } } },
        { variables: { input: { limit: 50, cursor: 'deeper-page' } } },
      ],
    });
    const handler = createActivityUpdatesHandler({
      client: client as never,
      host,
    });
    const revalidator = vi.fn();
    const unregister = registerEntityActivityRevalidator(revalidator);
    try {
      handler(pushedEvent(DOC_ID));
      handler(pushedEvent(DOC_ID));
      handler(pushedEvent(OTHER_ID));
      expect(client.query).not.toHaveBeenCalled();
      expect(revalidator).not.toHaveBeenCalled();

      await vi.advanceTimersByTimeAsync(MAX_FLUSH_DELAY_MS + 1);

      // One feed page-0 refetch (the deeper page is skipped), network-only.
      expect(client.query).toHaveBeenCalledTimes(1);
      const calls = client.query.mock.calls as unknown as Array<
        [unknown, Record<string, unknown>, { requestPolicy: string }]
      >;
      expect(calls[0]?.[2]).toMatchObject({ requestPolicy: 'network-only' });
      expect(JSON.stringify(calls[0]?.[1])).not.toContain('deeper-page');
      // Mounted entity panels hear about the whole burst exactly once.
      expect(revalidator).toHaveBeenCalledTimes(1);
      expect(revalidator).toHaveBeenCalledWith(new Set([DOC_ID, OTHER_ID]));
    } finally {
      unregister();
    }
  });

  it('ignores cache deletions', async () => {
    const client = fakeClient();
    const host = fakeHost({});
    const handler = createActivityUpdatesHandler({
      client: client as never,
      host,
    });

    handler({
      data: {
        activityUpdates: {
          __typename: 'GraphqlCacheDeletion' as const,
          graphqlTypeName: 'GraphqlActivityEvent',
          entityId: DOC_ID,
        },
      },
    } as never);

    await vi.advanceTimersByTimeAsync(MAX_FLUSH_DELAY_MS + 1);
    expect(client.query).not.toHaveBeenCalled();
  });

  it('defers the refetch while the tab is hidden and flushes on visibility', async () => {
    const client = fakeClient();
    const host = fakeHost({
      MyActivity: [{ variables: { input: { limit: 50, cursor: null } } }],
    });
    const handler = createActivityUpdatesHandler({
      client: client as never,
      host,
    });

    let hidden = true;
    Object.defineProperty(document, 'hidden', {
      configurable: true,
      get: () => hidden,
    });
    try {
      handler(pushedEvent(DOC_ID));
      await vi.advanceTimersByTimeAsync(MAX_FLUSH_DELAY_MS + 1);
      expect(client.query).not.toHaveBeenCalled();

      // Further pushes while hidden still don't refetch.
      handler(pushedEvent(OTHER_ID));
      await vi.advanceTimersByTimeAsync(MAX_FLUSH_DELAY_MS + 1);
      expect(client.query).not.toHaveBeenCalled();

      hidden = false;
      document.dispatchEvent(new Event('visibilitychange'));
      await vi.advanceTimersByTimeAsync(MAX_FLUSH_DELAY_MS + 1);
      expect(client.query).toHaveBeenCalledTimes(1);
    } finally {
      // Restore the prototype getter so other tests see the real value.
      Reflect.deleteProperty(document, 'hidden');
    }
  });

  it('does nothing when the cache host is disabled', async () => {
    const client = fakeClient();
    const host = { disabled: true, inspectQueryVariants: vi.fn() } as never;
    const handler = createActivityUpdatesHandler({
      client: client as never,
      host,
    });

    handler(pushedEvent(DOC_ID));
    await vi.advanceTimersByTimeAsync(MAX_FLUSH_DELAY_MS + 1);
    expect(client.query).not.toHaveBeenCalled();
  });
});
