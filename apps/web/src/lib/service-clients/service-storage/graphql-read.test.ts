import { HYDRATE_ONLY_CONTEXT_KEY } from '@graphql-cache/exchange/normalized-cache-exchange';
import { createClient, type Exchange, fetchExchange, gql } from '@urql/core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { readDeadlineExchange, toPromiseWithSignal } from './graphql-read';

const probeQuery = gql`
  query Probe {
    probe
  }
`;
const changeMutation = gql`
  mutation Change {
    change
  }
`;

/** A transport that never responds, but rejects once its request is aborted. */
function stalledTransport(exchanges: Exchange[] = [fetchExchange]) {
  const requests: RequestInit[] = [];
  const fetch = vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
    requests.push(init ?? {});
    return new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () =>
        reject(init.signal?.reason)
      );
    });
  });
  const client = createClient({
    url: 'https://dss.test/items/soup/graphql',
    exchanges,
    fetch,
  });
  return { client, requests };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('toPromiseWithSignal', () => {
  it('aborts the request when the caller aborts', async () => {
    const { client, requests } = stalledTransport();
    const controller = new AbortController();

    const result = toPromiseWithSignal(
      client.query(probeQuery, {}),
      controller.signal
    );
    await vi.waitFor(() => expect(requests).toHaveLength(1));
    controller.abort(new Error('view closed'));

    await expect(result).rejects.toThrow('view closed');
    expect(requests[0].signal?.aborted).toBe(true);
  });

  it('is needed because urql replaces a fetchOptions signal', async () => {
    const { client, requests } = stalledTransport();
    const controller = new AbortController();

    void client
      .query(probeQuery, {}, { fetchOptions: { signal: controller.signal } })
      .toPromise();
    await vi.waitFor(() => expect(requests).toHaveLength(1));
    controller.abort();

    expect(requests[0].signal).not.toBe(controller.signal);
    expect(requests[0].signal?.aborted).toBe(false);
  });

  it('rejects without a request when already aborted', async () => {
    const { client, requests } = stalledTransport();
    const controller = new AbortController();
    controller.abort(new Error('already closed'));

    await expect(
      toPromiseWithSignal(client.query(probeQuery, {}), controller.signal)
    ).rejects.toThrow('already closed');
    expect(requests).toHaveLength(0);
  });
});

describe('readDeadlineExchange', () => {
  it('fails a stalled query at the read deadline', async () => {
    const deadline = new AbortController();
    vi.spyOn(AbortSignal, 'timeout').mockReturnValue(deadline.signal);
    const { client, requests } = stalledTransport([
      readDeadlineExchange,
      fetchExchange,
    ]);

    const result = client.query(probeQuery, {}).toPromise();
    await vi.waitFor(() => expect(requests).toHaveLength(1));
    deadline.abort(new DOMException('signal timed out', 'TimeoutError'));

    const { error } = await result;
    expect(error?.networkError?.name).toBe('TimeoutError');
  });

  it('leaves mutations and background hydration to their own policies', async () => {
    const timeout = vi.spyOn(AbortSignal, 'timeout');
    const { client, requests } = stalledTransport([
      readDeadlineExchange,
      fetchExchange,
    ]);

    void client.mutation(changeMutation, {}).toPromise();
    void client
      .query(probeQuery, {}, { [HYDRATE_ONLY_CONTEXT_KEY]: true })
      .toPromise();
    await vi.waitFor(() => expect(requests).toHaveLength(2));

    expect(timeout).not.toHaveBeenCalled();
  });
});
