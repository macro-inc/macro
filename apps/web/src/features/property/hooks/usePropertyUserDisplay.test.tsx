/**
 * @vitest-environment jsdom
 */

import { storageServiceClient } from '@service-storage/client';
import { QueryClient, QueryClientProvider } from '@tanstack/solid-query';
import { createClient, type Operation } from '@urql/core';
import { err } from 'neverthrow';
import { createSignal } from 'solid-js';
import { render } from 'solid-js/web';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { map, pipe } from 'wonka';

vi.mock('@service-storage/client', () => ({
  storageServiceClient: { getBot: vi.fn() },
}));

const botRequests: string[][] = [];
const graphqlClient = createClient({
  url: '/graphql',
  exchanges: [
    () => (operations) =>
      pipe(
        operations,
        map((operation: Operation) => {
          const ids = (operation.variables as { ids: string[] }).ids;
          if (operation.kind === 'query') botRequests.push(ids);
          return {
            operation,
            data: {
              user: {
                id: 'viewer',
                bots: [
                  {
                    id: BOT_ID,
                    name: 'Research agent',
                    handle: 'research-agent',
                    avatarUrl: 'https://example.com/avatar.png',
                    deletedAt: null,
                    isSystem: false,
                  },
                ],
              },
            },
            stale: false,
            hasNext: false,
          };
        })
      ),
  ],
});
vi.mock('@service-storage/graphql-soup', () => ({
  getGraphqlSoupClient: () => graphqlClient,
  graphqlSoupRealtimeActive: () => true,
}));
vi.mock('@core/user', () => ({
  getDisplayName: () => 'Alice Example',
  tryMacroId: (id: string) => (id.startsWith('macro|') ? id : undefined),
  getDisplayNameParts: () => ({
    firstName: 'Alice',
    fullName: 'Alice Example',
  }),
}));

import { usePropertyUserDisplay } from './usePropertyUserDisplay';

const BOT_ID = '0193fd84-36d7-7fe1-914e-6b9fdbb208c8';
let queryClient: QueryClient;
let dispose: (() => void) | undefined;

function renderHook(factory: () => ReturnType<typeof usePropertyUserDisplay>) {
  let display!: ReturnType<typeof usePropertyUserDisplay>;
  dispose = render(
    () => (
      <QueryClientProvider client={queryClient}>
        {(() => {
          display = factory();
          return null;
        })()}
      </QueryClientProvider>
    ),
    document.body
  );
  return display;
}

beforeEach(() => {
  vi.clearAllMocks();
  queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  vi.mocked(storageServiceClient.getBot).mockResolvedValue(
    err([{ code: 'HTTP_ERROR', message: 'Forbidden' }])
  );
  botRequests.length = 0;
});

afterEach(() => {
  dispose?.();
  dispose = undefined;
  queryClient.clear();
});

describe('property user identity', () => {
  it('preserves human names without fetching a bot', () => {
    const display = renderHook(() =>
      usePropertyUserDisplay(() => 'macro|alice@example.com')
    );
    expect(queryClient.getQueryCache().getAll()).toHaveLength(0);
    expect(display.name()).toBe('Alice Example');
    expect(display.shortName()).toBe('Alice');
    expect(botRequests).toEqual([]);
    expect(storageServiceClient.getBot).not.toHaveBeenCalled();
  });

  it('resolves an assigned agent profile without permission to manage it', async () => {
    const [id, setId] = createSignal(`bot|${BOT_ID}`);
    const display = renderHook(() => usePropertyUserDisplay(id));

    expect(display.name()).toBe('Agent');
    expect(display.photoUrl()).toBeUndefined();
    await vi.waitFor(() => {
      expect(display.name()).toBe('Research agent');
    });
    expect(display.shortName()).toBe('Research agent');
    expect(display.photoUrl()).toBe('https://example.com/avatar.png');
    expect(botRequests).toEqual([[BOT_ID]]);
    expect(storageServiceClient.getBot).not.toHaveBeenCalled();

    setId('macro|alice@example.com');
    expect(display.name()).toBe('Alice Example');
    expect(display.photoUrl()).toBeUndefined();
  });
});
