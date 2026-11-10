/**
 * @vitest-environment jsdom
 */

import { storageServiceClient } from '@service-storage/client';
import { QueryClient, QueryClientProvider } from '@tanstack/solid-query';
import { ok } from 'neverthrow';
import { render } from 'solid-js/web';
import { afterEach, describe, expect, it, vi } from 'vitest';

let testQueryClient: QueryClient;

vi.mock('../client', () => ({
  get queryClient() {
    return testQueryClient;
  },
}));

vi.mock('@service-storage/client', () => ({
  storageServiceClient: {
    getAgentMemory: vi.fn(),
  },
}));

import { useAgentMemoryQuery } from './agent-memory';

let dispose: (() => void) | undefined;

afterEach(() => {
  dispose?.();
  dispose = undefined;
  vi.clearAllMocks();
});

describe('useAgentMemoryQuery', () => {
  it('reads the current memory again each time an editor opens', async () => {
    testQueryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false, staleTime: 5 * 60 * 1000 },
      },
    });
    vi.mocked(storageServiceClient.getAgentMemory)
      .mockResolvedValueOnce(
        ok({ content: '- Ship on Thursdays.', revision: 3, updated_at: null })
      )
      .mockResolvedValueOnce(
        ok({ content: '- Ship on Fridays.', revision: 4, updated_at: null })
      );

    let revision: (() => number | undefined) | undefined;
    const open = () =>
      render(
        () => (
          <QueryClientProvider client={testQueryClient}>
            {(() => {
              const memory = useAgentMemoryQuery(() => 'agent-1');
              revision = () => memory.data?.revision;
              return null;
            })()}
          </QueryClientProvider>
        ),
        document.body.appendChild(document.createElement('div'))
      );

    dispose = open();
    await vi.waitFor(() => expect(revision?.()).toBe(3));
    dispose();

    dispose = open();
    await vi.waitFor(() => expect(revision?.()).toBe(4));
    expect(storageServiceClient.getAgentMemory).toHaveBeenCalledTimes(2);
  });
});
