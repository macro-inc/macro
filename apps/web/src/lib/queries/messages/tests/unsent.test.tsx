import { render } from '@solidjs/testing-library';
import { MutationObserver, QueryClient } from '@tanstack/query-core';
import { QueryClientProvider } from '@tanstack/solid-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  SEND_MESSAGE_MUTATION_KEY,
  UNSENT_AFTER_MS,
  useMessageUnsent,
} from '../unsent';

function Probe(props: { id: string }) {
  const unsent = useMessageUnsent(() => props.id);
  return <output>{unsent() ? 'unsent' : 'ok'}</output>;
}

describe('useMessageUnsent', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

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
});
