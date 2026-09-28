/**
 * @vitest-environment jsdom
 */

import { agentHarnessServiceClient } from '@service-agent-harness/client';
import { QueryClient, QueryClientProvider } from '@tanstack/solid-query';
import { createSignal, type JSX } from 'solid-js';
import { render } from 'solid-js/web';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useAgentCapabilitiesQuery } from './capabilities';

vi.mock('@service-agent-harness/client', () => ({
  agentHarnessServiceClient: {
    discoverAgentCapabilities: vi.fn(),
  },
}));

let queryClient: QueryClient;
let dispose: (() => void) | undefined;

function renderHook(factory: () => unknown) {
  dispose = render(
    () => (
      <QueryClientProvider client={queryClient}>
        {(() => {
          factory();
          return null as unknown as JSX.Element;
        })()}
      </QueryClientProvider>
    ),
    document.body
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
});

afterEach(() => {
  dispose?.();
  dispose = undefined;
  queryClient.clear();
});

describe('agent capability discovery', () => {
  it('keys fresh discovery by the selected model and disables unsupported targets', async () => {
    vi.mocked(
      agentHarnessServiceClient.discoverAgentCapabilities
    ).mockReturnValue(new Promise<never>(() => {}));
    const [target, setTarget] = createSignal<{
      harness: 'cursor';
      model: string;
    }>();
    renderHook(() => useAgentCapabilitiesQuery(target));
    expect(
      agentHarnessServiceClient.discoverAgentCapabilities
    ).not.toHaveBeenCalled();
    setTarget({ harness: 'cursor', model: 'first' });
    await vi.waitFor(() =>
      expect(
        agentHarnessServiceClient.discoverAgentCapabilities
      ).toHaveBeenCalledTimes(1)
    );
    setTarget({ harness: 'cursor', model: 'second' });
    await vi.waitFor(() =>
      expect(
        agentHarnessServiceClient.discoverAgentCapabilities
      ).toHaveBeenCalledTimes(2)
    );
    expect(
      vi
        .mocked(agentHarnessServiceClient.discoverAgentCapabilities)
        .mock.calls.map(([request]) => request)
    ).toEqual([
      { harness: 'cursor', model: 'first' },
      { harness: 'cursor', model: 'second' },
    ]);
  });
});
