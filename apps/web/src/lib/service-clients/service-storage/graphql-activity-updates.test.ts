import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ACTIVITY_PUSH_DEBOUNCE_MS,
  createActivityUpdatesHandler,
} from './graphql-activity-updates';

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

  it('coalesces a burst into one pass refetching page 0 and matching entity variants', async () => {
    const client = fakeClient();
    const host = fakeHost({
      MyActivity: [
        { variables: { input: { limit: 50, cursor: null } } },
        { variables: { input: { limit: 50, cursor: 'deeper-page' } } },
      ],
      EntityActivity: [
        {
          variables: {
            input: { filters: { documentFilter: { literal: { id: DOC_ID } } } },
            limit: 20,
          },
        },
        {
          variables: {
            input: {
              filters: { documentFilter: { literal: { id: OTHER_ID } } },
            },
            limit: 20,
          },
        },
      ],
    });
    const handler = createActivityUpdatesHandler({
      client: client as never,
      host,
    });

    handler(pushedEvent(DOC_ID));
    handler(pushedEvent(DOC_ID));
    expect(client.query).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(ACTIVITY_PUSH_DEBOUNCE_MS + 1);

    // One feed page-0 refetch (the deeper page is skipped) and one entity
    // refetch (the other entity's variant is untouched), network-only.
    expect(client.query).toHaveBeenCalledTimes(2);
    const calls = client.query.mock.calls as unknown as Array<
      [unknown, Record<string, unknown>, { requestPolicy: string }]
    >;
    expect(
      calls.every(([, , context]) => context.requestPolicy === 'network-only')
    ).toBe(true);
    expect(JSON.stringify(calls[1]?.[1])).toContain(DOC_ID);
    expect(JSON.stringify(calls.map(([, vars]) => vars))).not.toContain(
      'deeper-page'
    );
    expect(JSON.stringify(calls.map(([, vars]) => vars))).not.toContain(
      OTHER_ID
    );
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

    await vi.advanceTimersByTimeAsync(ACTIVITY_PUSH_DEBOUNCE_MS + 1);
    expect(client.query).not.toHaveBeenCalled();
  });

  it('does nothing when the cache host is disabled', async () => {
    const client = fakeClient();
    const host = { disabled: true, inspectQueryVariants: vi.fn() } as never;
    const handler = createActivityUpdatesHandler({
      client: client as never,
      host,
    });

    handler(pushedEvent(DOC_ID));
    await vi.advanceTimersByTimeAsync(ACTIVITY_PUSH_DEBOUNCE_MS + 1);
    expect(client.query).not.toHaveBeenCalled();
  });
});
