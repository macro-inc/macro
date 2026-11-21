import { fireAndForget } from '@core/util/fireAndForget';
import { render } from '@solidjs/testing-library';
import { MutationObserver, QueryClient } from '@tanstack/query-core';
import { QueryClientProvider } from '@tanstack/solid-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  SEND_MESSAGE_MUTATION_KEY,
  UNSENT_AFTER_MS,
  useMessageUnsent,
} from '../unsent';

const { channelCacheHost } = vi.hoisted(() => ({
  channelCacheHost: vi.fn((): object | undefined => ({})),
}));
vi.mock('../local/flag', () => ({ channelCacheHost }));

function Probe(props: { id: string }) {
  const unsent = useMessageUnsent(() => props.id);
  return <output>{unsent() ? 'unsent' : 'ok'}</output>;
}

describe('useMessageUnsent', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    vi.useRealTimers();
    channelCacheHost.mockReturnValue({});
  });

  it('marks only a send that has stayed pending, until it settles', async () => {
    const client = new QueryClient();
    let deliver: (value: null) => void = () => {};
    const observer = new MutationObserver(client, {
      mutationKey: SEND_MESSAGE_MUTATION_KEY,
      mutationFn: (_vars: { optimisticId: string }) =>
        new Promise<null>((resolve) => {
          deliver = resolve;
        }),
    });
    const view = (id: string) =>
      render(() => (
        <QueryClientProvider client={client}>
          <Probe id={id} />
        </QueryClientProvider>
      ));
    const mine = view('m1');
    const other = view('m2');

    const sent = observer.mutate({ optimisticId: 'm1' });
    await vi.advanceTimersByTimeAsync(UNSENT_AFTER_MS - 1);
    expect(mine.container.textContent).toBe('ok');
    await vi.advanceTimersByTimeAsync(1);
    expect(mine.container.textContent).toBe('unsent');
    expect(other.container.textContent).toBe('ok');

    deliver(null);
    await sent;
    await vi.advanceTimersByTimeAsync(0);
    expect(mine.container.textContent).toBe('ok');
  });

  it('marks nothing while channels send over REST', async () => {
    channelCacheHost.mockReturnValue(undefined);
    const client = new QueryClient();
    const observer = new MutationObserver(client, {
      mutationKey: SEND_MESSAGE_MUTATION_KEY,
      mutationFn: (_vars: { optimisticId: string }) =>
        new Promise<null>(() => {}),
    });
    const view = render(() => (
      <QueryClientProvider client={client}>
        <Probe id="m1" />
      </QueryClientProvider>
    ));

    fireAndForgetMutate(observer);
    await vi.advanceTimersByTimeAsync(UNSENT_AFTER_MS + 1);

    expect(view.container.textContent).toBe('ok');
  });
});

function fireAndForgetMutate(
  observer: MutationObserver<null, Error, { optimisticId: string }>
): void {
  fireAndForget(observer.mutate({ optimisticId: 'm1' }), 'test');
}
