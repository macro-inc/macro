import {
  type Span,
  Telemetry,
  type TraceContext,
} from '@macro-inc/observability';
import {
  CombinedError,
  createClient,
  gql,
  type Operation,
  type OperationResult,
} from '@urql/core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { empty, makeSubject, mergeMap, pipe, type Subject } from 'wonka';
import { createQueryAuthorization } from '../../queries/authorization';
import { TRACE_PARENT_CONTEXT_KEY } from '../../urql-solid/trace-parent-exchange';
import {
  networkRevalidated,
  networkRevalidationExchange,
  registerNetworkRevalidation,
} from './network-revalidation-exchange';
import { withOptimisticMutationDisposition } from './optimistic';

const LIST = gql`query List { items { id tags } }`;
const DETAIL = gql`query Detail { item { id tags } }`;
const SAVE = gql`mutation Save { save { id tags } }`;

async function observeSettlement<T>(
  result: Promise<T>,
  settled: () => void
): Promise<T> {
  const value = await result;
  settled();
  return value;
}

function setup(enabled = () => true) {
  const requests: Array<{
    operation: Operation;
    response: Subject<OperationResult>;
  }> = [];
  const client = createClient({
    url: 'http://test/graphql',
    exchanges: [
      networkRevalidationExchange(enabled),
      () => (operations$) =>
        pipe(
          operations$,
          mergeMap((operation) => {
            if (operation.kind === 'teardown') return empty;
            const response = makeSubject<OperationResult>();
            requests.push({ operation, response });
            return response.source;
          })
        ),
    ],
  });
  function respond(index: number, result: Partial<OperationResult> = {}) {
    const { operation, response } = requests[index];
    response.next({
      operation,
      data: { tags: ['saved'] },
      stale: false,
      hasNext: false,
      ...result,
    });
  }
  const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
  return { client, requests, respond, flush };
}

describe('networkRevalidationExchange', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });
  it('updates every mounted query before releasing mutation optimism', async () => {
    const { client, requests, respond, flush } = setup();
    const events: string[] = [];
    const list = client.query(LIST, {}).subscribe(() => events.push('list'));
    const detail = client
      .query(DETAIL, {})
      .subscribe(() => events.push('detail'));
    respond(0);
    respond(1);
    events.length = 0;
    const saved = observeSettlement(client.mutation(SAVE, {}).toPromise(), () =>
      events.push('saved')
    );
    respond(2);
    await flush();
    expect(requests).toHaveLength(5);
    expect(
      requests.slice(3).map(({ operation }) => operation.context.requestPolicy)
    ).toEqual(['network-only', 'network-only']);
    respond(3);
    await flush();
    expect(events).toEqual(['list']);
    respond(4);
    await saved;
    expect(events).toEqual(['list', 'detail', 'saved']);
    list.unsubscribe();
    detail.unsubscribe();
  });

  it('reads the queries again in the trace the write named', async () => {
    const { client, requests, respond, flush } = setup();
    const list = client.query(LIST, {}).subscribe(() => {});
    respond(0);
    const runs = { parent: 0, reread: 0 };
    const parent: TraceContext = {
      run: (work) => {
        runs.parent += 1;
        return work();
      },
    };
    const reread = {
      setAttr: () => {},
      run: <T>(work: () => T) => {
        runs.reread += 1;
        return work();
      },
    } as unknown as Span;
    vi.spyOn(Telemetry, 'span').mockImplementation(((
      _name: string,
      operation: (span: Span) => Promise<unknown>
    ) => operation(reread)) as typeof Telemetry.span);
    const saved = client
      .mutation(SAVE, {}, { [TRACE_PARENT_CONTEXT_KEY]: parent })
      .toPromise();
    respond(1);
    await flush();
    expect(runs.parent).toBe(1);
    // The re-sent list's request joins the reread's trace; a later send of
    // the same operation, outside this write, does not.
    const resent = requests[2].operation.context[TRACE_PARENT_CONTEXT_KEY];
    resent?.run(() => {});
    resent?.run(() => {});
    expect(runs.reread).toBe(1);
    respond(2);
    await saved;
    list.unsubscribe();
  });

  it('captures fresh authorization for mutation-triggered revalidation', async () => {
    const { client, requests, respond, flush } = setup();
    const authorization = createQueryAuthorization(
      () => 'viewer:project',
      client
    );
    const list = client
      .query(LIST, {}, authorization.requestContext())
      .subscribe(authorization.onResult);
    respond(0);
    const denied = new CombinedError({ graphQLErrors: ['Forbidden'] });
    respond(0, { data: undefined, error: denied });
    expect(authorization.error()).toBe(denied);

    const saved = client.mutation(SAVE, {}).toPromise();
    respond(1);
    await flush();
    expect(requests).toHaveLength(3);
    respond(2);
    await saved;
    expect(authorization.error()).toBeUndefined();
    list.unsubscribe();
  });

  it('does not refetch on the healthy normalized-cache path', async () => {
    const { client, requests, respond } = setup(() => false);
    const list = client.query(LIST, {}).subscribe(() => {});
    respond(0);
    const saved = client.mutation(SAVE, {}).toPromise();
    respond(1);
    await saved;
    expect(
      requests.filter(({ operation }) => operation.kind === 'query')
    ).toHaveLength(1);
    list.unsubscribe();
  });

  it('rejects an old query response arriving after the post-save refresh', async () => {
    const { client, respond, flush } = setup();
    const values: unknown[] = [];
    const list = client
      .query(LIST, {})
      .subscribe((result) => values.push(result.data));
    const saved = client.mutation(SAVE, {}).toPromise();
    respond(1);
    await flush();
    respond(2, { data: { tags: ['new'] } });
    await saved;
    respond(0, { data: { tags: [] } });
    expect(values).toEqual([{ tags: ['new'] }]);
    list.unsubscribe();
  });

  it('waits for the newest refresh when saves overlap', async () => {
    const { client, respond, flush } = setup();
    const values: unknown[] = [];
    const list = client
      .query(LIST, {})
      .subscribe((result) => values.push(result.data));
    respond(0, { data: { tags: [] } });
    let settled = 0;
    const first = observeSettlement(
      client.mutation(SAVE, {}).toPromise(),
      () => settled++
    );
    const second = observeSettlement(
      client.mutation(SAVE, {}).toPromise(),
      () => settled++
    );
    respond(1);
    await flush();
    respond(2);
    await flush();
    respond(3, { data: { tags: ['first'] } });
    await flush();
    expect(settled).toBe(0);
    respond(4, { data: { tags: ['first', 'second'] } });
    await Promise.all([first, second]);
    expect(settled).toBe(2);
    expect(values).toEqual([{ tags: [] }, { tags: ['first', 'second'] }]);
    list.unsubscribe();
  });

  it('handles cache retirement after the queries have mounted', async () => {
    let fallback = false;
    const { client, requests, respond, flush } = setup(() => fallback);
    const list = client.query(LIST, {}).subscribe(() => {});
    respond(0);
    fallback = true;
    const saved = client.mutation(SAVE, {}).toPromise();
    respond(1);
    await flush();
    expect(requests).toHaveLength(3);
    respond(2);
    expect((await saved).error).toBeUndefined();
    list.unsubscribe();
  });

  it('does not turn cache-only queries into network requests', async () => {
    const { client, requests, respond } = setup();
    const list = client
      .query(LIST, {}, { requestPolicy: 'cache-only' })
      .subscribe(() => {});
    respond(0);
    const saved = client.mutation(SAVE, {}).toPromise();
    respond(1);
    await saved;
    expect(requests).toHaveLength(2);
    list.unsubscribe();
  });

  it('lets unmounting a query release the confirmed mutation', async () => {
    const { client, respond, flush } = setup();
    const list = client.query(LIST, {}).subscribe(() => {});
    respond(0);
    const saved = client.mutation(SAVE, {}).toPromise();
    respond(1);
    await flush();
    list.unsubscribe();
    expect((await saved).error).toBeUndefined();
  });

  it('bounds a stalled refresh without blocking later edits or accepting its old response', async () => {
    vi.useFakeTimers();
    const { client, respond } = setup();
    const detailValues: unknown[] = [];
    const list = client.query(LIST, {}).subscribe(() => {});
    const detail = client
      .query(DETAIL, {})
      .subscribe((result) => detailValues.push(result.data));
    respond(0);
    respond(1);
    detailValues.length = 0;
    const first = client.mutation(SAVE, {}).toPromise();
    respond(2);
    await vi.advanceTimersByTimeAsync(0);
    respond(3);
    await vi.advanceTimersByTimeAsync(15_000);
    expect((await first).error).toBeUndefined();

    let settled = false;
    const second = observeSettlement(
      client.mutation(SAVE, {}).toPromise(),
      () => {
        settled = true;
      }
    );
    respond(5);
    await vi.advanceTimersByTimeAsync(0);
    respond(4, { data: { tags: ['old'] } });
    await vi.advanceTimersByTimeAsync(0);
    expect(settled).toBe(false);
    respond(6);
    respond(7, { data: { tags: ['latest'] } });
    expect((await second).error).toBeUndefined();
    expect(detailValues).toEqual([{ tags: ['latest'] }]);
    list.unsubscribe();
    detail.unsubscribe();
  });

  it('preserves mutation success when a refresh fails', async () => {
    const { client, respond, flush } = setup();
    const errors: unknown[] = [];
    const list = client
      .query(LIST, {})
      .subscribe((result) => errors.push(result.error));
    respond(0);
    const saved = client.mutation(SAVE, {}).toPromise();
    respond(1);
    await flush();
    const error = new CombinedError({ networkError: new Error('offline') });
    respond(2, { data: undefined, error });
    expect((await saved).error).toBeUndefined();
    expect(errors.at(-1)).toBe(error);
    // A caller that would read the list itself still does.
    expect(networkRevalidated(await saved)).toBe(false);
    list.unsubscribe();
  });

  it('does not refresh queries after a failed mutation', async () => {
    const { client, requests, respond } = setup();
    const list = client.query(LIST, {}).subscribe(() => {});
    respond(0);
    const saved = client.mutation(SAVE, {}).toPromise();
    const error = new CombinedError({
      graphQLErrors: [{ message: 'forbidden' }],
    });
    respond(1, { data: undefined, error });
    expect((await saved).error).toBe(error);
    expect(
      requests.filter(({ operation }) => operation.kind === 'query')
    ).toHaveLength(1);
    list.unsubscribe();
  });

  it('reads queries again for a write that committed without its rows, keeping its error', async () => {
    const { client, respond, flush } = setup();
    const list = client.query(LIST, {}).subscribe(() => {});
    respond(0);
    const saved = client.mutation(SAVE, {}).toPromise();
    const error = new CombinedError({
      graphQLErrors: [
        {
          message: 'A changed item could not be read back',
          path: ['save', 'results', 0, 'effects'],
        },
      ],
    });
    respond(1, { data: { save: { results: [] } }, error });
    await flush();
    respond(2);
    const result = await saved;
    expect(result.error).toBe(error);
    expect(networkRevalidated(result)).toBe(true);
    list.unsubscribe();
  });

  it.each([
    ['an error outside its rows', ['save'], undefined],
    ['an HTTP 5xx', ['save', 'results', 0, 'effects'], 503],
  ])(
    'does not read queries again for a write with %s',
    async (_case, path, status) => {
      const { client, requests, respond, flush } = setup();
      const list = client.query(LIST, {}).subscribe(() => {});
      respond(0);
      const saved = client.mutation(SAVE, {}).toPromise();
      const error = new CombinedError({
        graphQLErrors: [{ message: 'failed', path }],
        response: status ? new Response(null, { status }) : undefined,
      });
      respond(1, { data: { save: { results: [] } }, error });
      const result = await saved;
      await flush();
      expect(result.error).toBe(error);
      expect(networkRevalidated(result)).toBe(false);
      expect(
        requests.filter(({ operation }) => operation.kind === 'query')
      ).toHaveLength(1);
      list.unsubscribe();
    }
  );

  it('reads queries again after a write whose response was lost, without holding its error', async () => {
    const { client, requests, respond, flush } = setup();
    const list = client.query(LIST, {}).subscribe(() => {});
    respond(0);
    const saved = client.mutation(SAVE, {}).toPromise();
    const error = new CombinedError({ networkError: new Error('dropped') });
    respond(1, { data: undefined, error });
    const result = await saved;
    expect(result.error).toBe(error);
    expect(networkRevalidated(result)).toBe(false);
    await flush();
    expect(
      requests.filter(({ operation }) => operation.kind === 'query')
    ).toHaveLength(2);
    list.unsubscribe();
  });

  it('reads queries again after a lost write the cache gave up on', async () => {
    const { client, requests, respond, flush } = setup();
    const list = client.query(LIST, {}).subscribe(() => {});
    respond(0);
    const saved = client.mutation(SAVE, {}).toPromise();
    const error = new CombinedError({ networkError: new Error('dropped') });
    const failed = withOptimisticMutationDisposition(
      {
        operation: requests[1].operation,
        data: undefined,
        error,
        stale: false,
        hasNext: false,
      },
      { kind: 'permanently-failed' }
    );
    respond(1, failed);
    expect((await saved).error).toBe(error);
    await flush();
    expect(
      requests.filter(({ operation }) => operation.kind === 'query')
    ).toHaveLength(2);
    list.unsubscribe();
  });

  it('marks a write whose queries it read again before it settled', async () => {
    const { client, respond, flush } = setup();
    const list = client.query(LIST, {}).subscribe(() => {});
    respond(0);
    const saved = client.mutation(SAVE, {}).toPromise();
    respond(1);
    await flush();
    respond(2);
    expect(networkRevalidated(await saved)).toBe(true);
    list.unsubscribe();
  });

  it('leaves a write it did not read for unmarked', async () => {
    const { client, respond } = setup(() => false);
    const saved = client.mutation(SAVE, {}).toPromise();
    respond(0);
    expect(networkRevalidated(await saved)).toBe(false);
  });

  it('lets a paged reader read its own pages again, once per write', async () => {
    const { client, requests, respond, flush } = setup();
    const owner = vi.fn(async () => {});
    const context = {
      networkRevalidation: {
        revalidate: owner,
        active: () => true,
        gone: () => false,
      },
    };
    const first = client.query(LIST, { page: 1 }, context).subscribe(() => {});
    const second = client.query(LIST, { page: 2 }, context).subscribe(() => {});
    respond(0);
    respond(1);
    const saved = client.mutation(SAVE, {}).toPromise();
    respond(2);
    await saved;
    await flush();
    expect(owner).toHaveBeenCalledOnce();
    // The owner reads its pages in order itself; nothing re-sends them.
    expect(requests).toHaveLength(3);
    first.unsubscribe();
    second.unsubscribe();
  });

  it('settles the write when a paged reader fails or stalls its read', async () => {
    vi.useFakeTimers();
    const { client, respond } = setup();
    const failing = client
      .query(
        LIST,
        { page: 1 },
        {
          networkRevalidation: {
            revalidate: async () => {
              throw new Error('offline');
            },
            active: () => true,
            gone: () => false,
          },
        }
      )
      .subscribe(() => {});
    const stalled = client
      .query(
        DETAIL,
        {},
        {
          networkRevalidation: {
            revalidate: () => new Promise(() => {}),
            active: () => true,
            gone: () => false,
          },
        }
      )
      .subscribe(() => {});
    respond(0);
    respond(1);
    let settled = false;
    const saved = client.mutation(SAVE, {}).toPromise();
    const done = (async () => {
      await saved;
      settled = true;
    })();
    respond(2);
    await vi.advanceTimersByTimeAsync(0);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(15_000);
    await done;
    expect((await saved).error).toBeUndefined();
    expect(networkRevalidated(await saved)).toBe(false);
    failing.unsubscribe();
    stalled.unsubscribe();
  });

  it('leaves a paged reader that outlasts the wait outside the write trace', async () => {
    vi.useFakeTimers();
    const { client, respond } = setup();
    let rereadRuns = 0;
    const reread = {
      setAttr: () => {},
      run: <T>(work: () => T) => {
        rereadRuns += 1;
        return work();
      },
    } as unknown as Span;
    vi.spyOn(Telemetry, 'span').mockImplementation(((
      _name: string,
      operation: (span: Span) => Promise<unknown>
    ) => operation(reread)) as typeof Telemetry.span);
    let trace: TraceContext | undefined;
    const list = client
      .query(
        LIST,
        { page: 1 },
        {
          networkRevalidation: {
            revalidate: (given) => {
              trace = given;
              return new Promise(() => {});
            },
            active: () => true,
            gone: () => false,
          },
        }
      )
      .subscribe(() => {});
    respond(0);
    const saved = client.mutation(SAVE, {}).toPromise();
    respond(1);
    await vi.advanceTimersByTimeAsync(0);
    // A page sent while the exchange waits joins the reread.
    trace?.run(() => {});
    expect(rereadRuns).toBe(1);
    await vi.advanceTimersByTimeAsync(15_000);
    await saved;
    // One sent after it gave up, such as a recovery's read, does not.
    trace?.run(() => {});
    expect(rereadRuns).toBe(1);
    list.unsubscribe();
  });

  it('re-sends a query whose paged reader is gone', async () => {
    const { client, requests, respond, flush } = setup();
    let mounted = true;
    const owner = vi.fn(async () => {});
    const list = client
      .query(
        LIST,
        { page: 1 },
        {
          networkRevalidation: {
            revalidate: owner,
            active: () => mounted,
            gone: () => !mounted,
          },
        }
      )
      .subscribe(() => {});
    respond(0);
    // The list is gone while another reader keeps the same page mounted.
    mounted = false;
    const saved = client.mutation(SAVE, {}).toPromise();
    respond(1);
    await flush();
    respond(2);
    await saved;
    expect(owner).not.toHaveBeenCalled();
    expect(
      requests.filter(({ operation }) => operation.kind === 'query')
    ).toHaveLength(2);
    list.unsubscribe();
  });

  it('leaves a paused reader its pages without re-sending them', async () => {
    const { client, requests, respond, flush } = setup();
    const owner = vi.fn(async () => {});
    const list = client
      .query(
        LIST,
        { page: 1 },
        {
          networkRevalidation: {
            revalidate: owner,
            active: () => false,
            gone: () => false,
          },
        }
      )
      .subscribe(() => {});
    respond(0);
    const saved = client.mutation(SAVE, {}).toPromise();
    respond(1);
    await saved;
    await flush();
    expect(owner).not.toHaveBeenCalled();
    expect(
      requests.filter(({ operation }) => operation.kind === 'query')
    ).toHaveLength(1);
    list.unsubscribe();
  });

  it('sends a page in flight again when the write commits, and lets its reader read', async () => {
    const { client, requests, respond, flush } = setup();
    const owner = vi.fn(async () => {});
    const list = client
      .query(
        LIST,
        { page: 1 },
        {
          networkRevalidation: {
            revalidate: owner,
            active: () => true,
            gone: () => false,
          },
        }
      )
      .subscribe(() => {});
    // The page's request started before the write and has not answered:
    // urql would join the reader's own read onto it.
    const saved = client.mutation(SAVE, {}).toPromise();
    respond(1);
    await flush();
    expect(owner).toHaveBeenCalledOnce();
    const queries = requests.filter(
      ({ operation }) => operation.kind === 'query'
    );
    expect(queries).toHaveLength(2);
    expect(queries[1].operation.context.requestPolicy).toBe('network-only');
    respond(requests.indexOf(queries[1]));
    await saved;
    list.unsubscribe();
  });

  it('reads a list registered with the client whose operations never reached it', async () => {
    const { client, respond, flush } = setup();
    const owner = vi.fn(async () => {});
    const unregister = registerNetworkRevalidation(client, {
      revalidate: owner,
      active: () => true,
      gone: () => false,
    });
    const first = client.mutation(SAVE, {}).toPromise();
    respond(0);
    await first;
    await flush();
    expect(owner).toHaveBeenCalledOnce();
    unregister();
    const second = client.mutation(SAVE, {}).toPromise();
    respond(1);
    await second;
    await flush();
    expect(owner).toHaveBeenCalledOnce();
  });
});
