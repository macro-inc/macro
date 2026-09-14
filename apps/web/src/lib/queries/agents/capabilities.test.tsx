/**
 * @vitest-environment jsdom
 */

import { agentHarnessServiceClient } from '@service-agent-harness/client';
import { QueryClient, QueryClientProvider } from '@tanstack/solid-query';
import type { JSX } from 'solid-js';
import { render } from 'solid-js/web';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  buildAgentCapabilityTargets,
  useAgentCapabilitiesQueries,
} from './capabilities';

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
  it('constructs every available target in parallel without waiting for another target', async () => {
    const targets = buildAgentCapabilityTargets(true, [
      { id: 'harness-a' },
      { id: 'harness-b' },
    ]);
    const pending = new Promise<never>(() => {});
    vi.mocked(
      agentHarnessServiceClient.discoverAgentCapabilities
    ).mockReturnValue(pending);

    renderHook(() => useAgentCapabilitiesQueries(() => targets));

    await vi.waitFor(() => {
      expect(
        agentHarnessServiceClient.discoverAgentCapabilities
      ).toHaveBeenCalledTimes(4);
    });
    expect(
      vi
        .mocked(agentHarnessServiceClient.discoverAgentCapabilities)
        .mock.calls.map(([request]) => request)
    ).toEqual([
      { harness: 'in-memory' },
      { harness: 'cursor' },
      { harness: 'macrod', harnessId: 'harness-a' },
      { harness: 'macrod', harnessId: 'harness-b' },
    ]);
  });

  it('omits Cursor when it is not registered', () => {
    expect(buildAgentCapabilityTargets(false, [{ id: 'harness-a' }])).toEqual([
      { harness: 'in-memory' },
      { harness: 'macrod', harnessId: 'harness-a' },
    ]);
  });
});
