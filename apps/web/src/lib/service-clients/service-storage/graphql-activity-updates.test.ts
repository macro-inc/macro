import { ENTITY_ACTIVITY_PREVIEW_LIMIT } from '@queries/activity/constants';
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
const VIEWER = 'macro|teo@example.com';

function pushedEvent(entityId: string, subjectId = VIEWER) {
  return {
    data: {
      activityUpdates: {
        __typename: 'GraphqlActivityEvent' as const,
        id: '33333333-3333-4333-8333-333333333333',
        actorId: subjectId,
        subjectId,
        entityType: 'DOCUMENT' as const,
        entityId,
        occurredAt: '2026-08-15T00:00:00Z',
        action: { __typename: 'GraphqlActivityEdited' as const },
      },
    },
  } as never;
}

/**
 * The handler reads the feed through `inspect` (instances with cached
 * values, carrying the viewer's id) and the entity previews through
 * `inspectVariants` (recovered variables only).
 */
function fakeHost(config: {
  feedInstances?: unknown[];
  entityVariants?: unknown[];
}) {
  return {
    disabled: false,
    inspectQuery: vi.fn(async () => config.feedInstances ?? []),
    inspectQueryVariants: vi.fn(async () => config.entityVariants ?? []),
  } as never;
}

function feedPageZero(viewerId = VIEWER) {
  return {
    variables: { input: { limit: 50, cursor: null } },
    value: { id: viewerId },
  };
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
      feedInstances: [
        feedPageZero(),
        {
          variables: { input: { limit: 50, cursor: 'deeper-page' } },
          value: { id: VIEWER },
        },
      ],
      // Recovered variants carry only the soup field's own arguments — the
      // deeper `activity(limit:)` argument is never inverted back.
      entityVariants: [
        {
          variables: {
            input: { filters: { documentFilter: { literal: { id: DOC_ID } } } },
          },
        },
        {
          variables: {
            input: {
              filters: { documentFilter: { literal: { id: OTHER_ID } } },
            },
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

    await vi.advanceTimersByTimeAsync(MAX_FLUSH_DELAY_MS + 1);

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
    // The refetch restores the preview limit the panel's variant reads;
    // without it the response writes under `activity(limit: null)`.
    expect(calls[1]?.[1]).toMatchObject({
      limit: ENTITY_ACTIVITY_PREVIEW_LIMIT,
    });
    expect(JSON.stringify(calls.map(([, vars]) => vars))).not.toContain(
      'deeper-page'
    );
    expect(JSON.stringify(calls.map(([, vars]) => vars))).not.toContain(
      OTHER_ID
    );
  });

  it('skips the feed refetch for pushes about other subjects', async () => {
    const client = fakeClient();
    const host = fakeHost({
      feedInstances: [feedPageZero()],
      entityVariants: [
        {
          variables: {
            input: { filters: { documentFilter: { literal: { id: DOC_ID } } } },
          },
        },
      ],
    });
    const handler = createActivityUpdatesHandler({
      client: client as never,
      host,
    });

    // An entity-audience delivery: someone else acted on an entity this
    // viewer watches. Their panel refreshes; their feed cannot contain it.
    handler(pushedEvent(DOC_ID, 'macro|colleague@example.com'));
    await vi.advanceTimersByTimeAsync(MAX_FLUSH_DELAY_MS + 1);

    expect(client.query).toHaveBeenCalledTimes(1);
    const [, variables] = client.query.mock.calls[0] as unknown as [
      unknown,
      Record<string, unknown>,
    ];
    expect(JSON.stringify(variables)).toContain(DOC_ID);
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
    const host = fakeHost({ feedInstances: [feedPageZero()] });
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
    const host = {
      disabled: true,
      inspectQuery: vi.fn(),
      inspectQueryVariants: vi.fn(),
    } as never;
    const handler = createActivityUpdatesHandler({
      client: client as never,
      host,
    });

    handler(pushedEvent(DOC_ID));
    await vi.advanceTimersByTimeAsync(MAX_FLUSH_DELAY_MS + 1);
    expect(client.query).not.toHaveBeenCalled();
  });
});
