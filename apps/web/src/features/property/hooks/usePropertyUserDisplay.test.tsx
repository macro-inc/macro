/**
 * @vitest-environment jsdom
 */

import { storageServiceClient } from '@service-storage/client';
import { QueryClient, QueryClientProvider } from '@tanstack/solid-query';
import { err, ok } from 'neverthrow';
import { createSignal } from 'solid-js';
import { render } from 'solid-js/web';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@service-storage/client', () => ({
  storageServiceClient: {
    getBot: vi.fn(),
    getBotOwnerProfiles: vi.fn(),
  },
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
  vi.mocked(storageServiceClient.getBotOwnerProfiles).mockResolvedValue(
    ok([
      {
        id: BOT_ID,
        name: 'Research agent',
        avatar_url: 'https://example.com/avatar.png',
      },
    ])
  );
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
    expect(display.name()).toBe('Alice Example');
    expect(display.shortName()).toBe('Alice');
    expect(storageServiceClient.getBotOwnerProfiles).not.toHaveBeenCalled();
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
    expect(storageServiceClient.getBotOwnerProfiles).toHaveBeenCalledWith({
      ids: [BOT_ID],
    });
    expect(storageServiceClient.getBot).not.toHaveBeenCalled();

    setId('macro|alice@example.com');
    expect(display.name()).toBe('Alice Example');
    expect(display.photoUrl()).toBeUndefined();
  });
});
