import { cognitionApiServiceClient } from '@service-cognition/client';
import { QueryClient, QueryClientProvider } from '@tanstack/solid-query';
import { err } from 'neverthrow';
import { createRoot } from 'solid-js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createAIProjection } from '../projection';

vi.mock('@service-cognition/client', () => ({
  cognitionApiServiceClient: { upsertAiProjection: vi.fn() },
}));
vi.mock('@service-connection/websocket', () => ({
  createConnectionWebsocketEffect: vi.fn(),
}));

afterEach(() => {
  vi.clearAllMocks();
});

function mountProjection() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  let projection!: ReturnType<typeof createAIProjection>;
  const dispose = createRoot((cleanup) => {
    QueryClientProvider({
      client: queryClient,
      get children() {
        projection = createAIProjection(() => ({
          id: 'test/projection',
          prompt: 'Summarize.',
        }));
        return null;
      },
    });
    return cleanup;
  });
  return { projection, dispose };
}

describe('createAIProjection isForbidden', () => {
  it('reports a 403 that only a refresh received', async () => {
    vi.mocked(cognitionApiServiceClient.upsertAiProjection)
      .mockResolvedValueOnce(err([{ code: 'SERVER_ERROR', message: 'boom' }]))
      .mockResolvedValueOnce(
        err([{ code: 'FORBIDDEN', message: 'professional features required' }])
      );

    const { projection, dispose } = mountProjection();
    try {
      await vi.waitFor(() => expect(projection.error()).toBe('boom'));
      expect(projection.isForbidden()).toBe(false);

      await expect(projection.refresh()).rejects.toThrow(
        'professional features required'
      );
      expect(projection.isForbidden()).toBe(true);
    } finally {
      dispose();
    }
  });
});
