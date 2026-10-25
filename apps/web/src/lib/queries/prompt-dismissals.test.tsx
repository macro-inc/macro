import { queryClient } from '@queries/client';
import { cleanup, render, waitFor } from '@solidjs/testing-library';
import { QueryClientProvider } from '@tanstack/solid-query';
import { errAsync, okAsync } from 'neverthrow';
import { createSignal, type JSX } from 'solid-js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  usePromptDismissalsQuery,
  useWarmPromptDismissals,
} from './prompt-dismissals';

const server = vi.hoisted(() => ({ list: vi.fn() }));
vi.mock('@queries/client', async () => {
  const { QueryClient } = await import('@tanstack/solid-query');
  return { queryClient: new QueryClient() };
});
vi.mock('@service-cognition/prompt-dismissals', () => ({
  promptDismissalsClient: { list: server.list, dismiss: vi.fn() },
}));

afterEach(() => {
  cleanup();
  queryClient.clear();
  server.list.mockReset();
});

function app(children: () => JSX.Element) {
  function Warm() {
    useWarmPromptDismissals(() => 'user');
    return null;
  }
  return render(() => (
    <QueryClientProvider client={queryClient}>
      <Warm />
      {children()}
    </QueryClientProvider>
  ));
}

describe('prompt dismissals', () => {
  it('fails fast, and a card mounted later reads the failure without refetching', async () => {
    server.list.mockReturnValue(errAsync([{ code: 'NOT_FOUND' }]));
    const [mounted, setMounted] = createSignal(false);
    let status = '';
    function Card() {
      const query = usePromptDismissalsQuery();
      status = query.status;
      return null;
    }
    app(() => (mounted() ? <Card /> : null));
    await waitFor(() => expect(server.list).toHaveBeenCalledTimes(1));
    await new Promise((resolve) => setTimeout(resolve, 20));
    setMounted(true);
    expect(status).toBe('error');
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(server.list).toHaveBeenCalledTimes(1);
  });

  it('serves the loaded list to a card at once', async () => {
    server.list.mockReturnValue(okAsync({ dismissed: ['home-setup'] }));
    const [mounted, setMounted] = createSignal(false);
    let dismissed: string[] | undefined;
    function Card() {
      const query = usePromptDismissalsQuery();
      dismissed = query.isSuccess ? query.data.dismissed : undefined;
      return null;
    }
    app(() => (mounted() ? <Card /> : null));
    await waitFor(() => expect(server.list).toHaveBeenCalledTimes(1));
    await new Promise((resolve) => setTimeout(resolve, 20));
    setMounted(true);
    expect(dismissed).toEqual(['home-setup']);
    expect(server.list).toHaveBeenCalledTimes(1);
  });
});
