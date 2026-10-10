import type { ApiThread } from '@service-email/generated/schemas';
import { QueryClient, QueryClientProvider } from '@tanstack/solid-query';
import { type Ok, ok } from 'neverthrow';
import { createComponent, createRoot, createSignal } from 'solid-js';
import { expect, it, vi } from 'vitest';

const getThread = vi.hoisted(() => vi.fn());
vi.mock('@service-email/client', () => ({ emailClient: { getThread } }));
vi.mock('@app/lib/analytics/posthog', async (original) => ({
  ...(await original<typeof import('@app/lib/analytics/posthog')>()),
  useFeatureFlag: () => () => ({ enabled: false }),
}));
vi.mock('./graphql/thread', () => ({
  createGraphqlEmailThreadQuery: (threadId: () => string) => ({
    query: {},
    resolvedThreadId: threadId,
  }),
  fetchGraphqlEmailThread: vi.fn(),
  mapGraphqlThreadError: vi.fn(),
}));

import { type ThreadQueryResult, useThreadQuery } from './thread';

function thread(id: string): ApiThread {
  return {
    db_id: id,
    link_id: 'inbox',
    access_level: 'owner',
    inbox_visible: true,
    is_read: true,
    created_at: '2026-10-08T00:00:00Z',
    updated_at: '2026-10-08T00:00:00Z',
    messages: [],
  };
}

it('retains the REST response identity independently of consumer selection and route changes', async () => {
  getThread.mockResolvedValueOnce(ok({ thread: thread('canonical') }));
  const next = Promise.withResolvers<Ok<{ thread: ApiThread }, unknown>>();
  getThread.mockReturnValueOnce(next.promise);
  const [route, setRoute] = createSignal('retained-source');
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  let query!: ThreadQueryResult<number>;
  const dispose = createRoot((dispose) => {
    createComponent(QueryClientProvider, {
      client,
      get children() {
        query = useThreadQuery(route, () => ({
          select: (pages) => pages.pages[0].messages.length,
        }));
        return null;
      },
    });
    return dispose;
  });
  try {
    await vi.waitFor(() => expect(query.isSuccess).toBe(true));
    expect(query.data).toBe(0);
    expect(query.resolvedThreadId).toBe('canonical');
    setRoute('other');
    expect(query.resolvedThreadId).toBe('other');
    await vi.waitFor(() => expect(getThread).toHaveBeenCalledTimes(2));
    next.resolve(ok({ thread: thread('other') }));
    await vi.waitFor(() => expect(query.isSuccess).toBe(true));
    expect(query.resolvedThreadId).toBe('other');
  } finally {
    dispose();
    client.clear();
  }
});
