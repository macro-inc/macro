import { queryClient } from '@queries/client';
import { cleanup, render } from '@solidjs/testing-library';
import { QueryClientProvider } from '@tanstack/solid-query';
import { createSignal } from 'solid-js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createDialpadConnection } from './create-dialpad-connection';

const mocks = vi.hoisted(() => ({ get: vi.fn(), complete: vi.fn() }));
vi.mock('@service-cognition/client', () => ({
  cognitionApiServiceClient: {
    getDialpadConnection: mocks.get,
    completeDialpadConnection: mocks.complete,
  },
}));
vi.mock('@queries/client', async () => {
  const { QueryClient } = await import('@tanstack/solid-query');
  return {
    queryClient: new QueryClient({
      defaultOptions: { queries: { retry: false } },
    }),
  };
});
vi.mock('@core/component/Toast/Toast', () => ({ toast: { failure: vi.fn() } }));
vi.mock('@core/pipedream/oauth-popup', () => ({
  assignOauthUrl: vi.fn(),
  reserveOauthPopup: vi.fn(),
}));

afterEach(() => {
  cleanup();
  queryClient.clear();
  vi.useRealTimers();
  vi.clearAllMocks();
});

function mount(initiallyEnabled: boolean) {
  const [enabled, setEnabled] = createSignal(initiallyEnabled);
  function View() {
    const dialpad = createDialpadConnection(enabled);
    return <div>{dialpad.connection()?.state ?? 'loading'}</div>;
  }
  render(() => (
    <QueryClientProvider client={queryClient}>
      <View />
    </QueryClientProvider>
  ));
  return setEnabled;
}

describe('Dialpad connection requests', () => {
  it('does not fetch or finish a cached connection while disabled', async () => {
    vi.useFakeTimers();
    queryClient.setQueryData(['dialpad', 'connection'], {
      state: 'connecting',
    });
    mount(false);
    await vi.advanceTimersByTimeAsync(8_000);
    expect(mocks.get).not.toHaveBeenCalled();
    expect(mocks.complete).not.toHaveBeenCalled();
  });

});
