import { renderHook } from '@solidjs/testing-library';
import { QueryClient, QueryClientProvider } from '@tanstack/solid-query';
import { ok } from 'neverthrow';
import type { ParentProps } from 'solid-js';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useSuggestionGeneration } from './generation';
import { useSuggestionsSource } from './suggestions-source';

const server = vi.hoisted(() => ({
  state: 'idle' as 'idle' | 'running',
  status: 0,
  feed: 0,
}));

vi.mock('@service-scheduled-action/client', () => ({
  scheduledActionClient: {
    suggestionGeneration: async () => {
      server.status += 1;
      return ok({ state: server.state });
    },
    listSuggestions: async () => {
      server.feed += 1;
      return ok({ suggestions: [], done: [] });
    },
  },
}));
vi.mock('../use-suggestions-flag', () => ({
  useSuggestionsFlag: () => () => true,
}));
vi.mock('@core/context/user', () => ({ useUserId: () => () => 'user-1' }));

function mount() {
  const client = new QueryClient({
    defaultOptions: { queries: { refetchOnWindowFocus: false } },
  });
  const wrapper = (props: ParentProps) => (
    <QueryClientProvider client={client}>{props.children}</QueryClientProvider>
  );

  return renderHook(
    () => ({
      source: useSuggestionsSource(),
      generation: useSuggestionGeneration(),
    }),
    { wrapper }
  );
}

beforeEach(() => {
  vi.useFakeTimers();
  server.state = 'idle';
  server.status = 0;
  server.feed = 0;
});
afterEach(() => vi.useRealTimers());

it('reads the status and the feed once and polls nothing while idle', async () => {
  mount();
  await vi.advanceTimersByTimeAsync(60_000);

  expect(server.status).toBe(1);
  expect(server.feed).toBe(1);
});

it('asks for the status every 3 s and the feed every 10 s while a generation runs, then reads the feed once more when it ends', async () => {
  server.state = 'running';
  mount();
  await vi.advanceTimersByTimeAsync(100);
  expect(server.status).toBe(1);
  expect(server.feed).toBe(1);

  await vi.advanceTimersByTimeAsync(10_000);
  // 3 s, 6 s and 9 s for the status; 10 s for the feed.
  expect(server.status).toBe(4);
  expect(server.feed).toBe(2);

  server.state = 'idle';
  await vi.advanceTimersByTimeAsync(3_000);
  expect(server.status).toBe(5);
  // The read that follows the generation ending.
  expect(server.feed).toBe(3);

  await vi.advanceTimersByTimeAsync(60_000);
  expect(server.status).toBe(5);
  expect(server.feed).toBe(3);
});
