import {
  CombinedError,
  createClient,
  gql,
  type Operation,
  type OperationResult,
} from '@urql/core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { empty, makeSubject, mergeMap, pipe, type Subject } from 'wonka';
import { networkRevalidationExchange } from './network-revalidation-exchange';

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
  afterEach(() => vi.useRealTimers());
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
});
