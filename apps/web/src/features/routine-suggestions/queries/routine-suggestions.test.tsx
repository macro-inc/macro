import { queryClient } from '@queries/client';
import type { RoutineSuggestionSet } from '@service-cognition/routine-suggestions';
import { cleanup, render, waitFor } from '@solidjs/testing-library';
import { QueryClientProvider } from '@tanstack/solid-query';
import { okAsync } from 'neverthrow';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FIXTURE_ROUTINE_SUGGESTIONS } from '../tests/fixture-suggestions';
import {
  createRoutineSuggestions,
  type RoutineSuggestionsSource,
} from './routine-suggestions';

const server = vi.hoisted(() => ({ get: vi.fn(), refresh: vi.fn() }));
vi.mock('@queries/client', async () => {
  const { QueryClient } = await import('@tanstack/solid-query');
  return { queryClient: new QueryClient() };
});
vi.mock('@service-cognition/routine-suggestions', () => ({
  routineSuggestionsClient: server,
}));

afterEach(() => {
  cleanup();
  queryClient.clear();
  server.get.mockReset();
  server.refresh.mockReset();
});

const [first] = FIXTURE_ROUTINE_SUGGESTIONS;

function set(overrides: Partial<RoutineSuggestionSet>): RoutineSuggestionSet {
  return {
    status: 'ready',
    suggestions: [first],
    generatedAt: '2026-10-27T09:00:00Z',
    ...overrides,
  };
}

function mount(): RoutineSuggestionsSource {
  let source: RoutineSuggestionsSource | undefined;
  function Probe() {
    source = createRoutineSuggestions({ ready: () => true });
    return null;
  }
  render(() => (
    <QueryClientProvider client={queryClient}>
      <Probe />
    </QueryClientProvider>
  ));
  if (!source) throw new Error('source did not mount');
  return source;
}

describe('createRoutineSuggestions', () => {
  it('waits while the first set generates, then shows it', async () => {
    server.get
      .mockReturnValueOnce(
        okAsync(
          set({ status: 'generating', suggestions: [], generatedAt: null })
        )
      )
      .mockReturnValue(okAsync(set({})));

    const source = mount();

    await waitFor(() => expect(source.generating()).toBe(true));
    expect(source.suggestions()).toBeUndefined();
    expect(source.error()).toBeUndefined();
    await waitFor(
      () =>
        expect(source.suggestions()?.map((s) => s.title)).toEqual([
          first.title,
        ]),
      { timeout: 5_000 }
    );
    expect(source.generating()).toBe(false);
  });

  it('keeps the same rows when a refetch answers with the same set', async () => {
    server.get.mockImplementation(() => okAsync(set({})));
    const source = mount();
    await waitFor(() => expect(source.suggestions()).toHaveLength(1));
    const [before] = source.suggestions() ?? [];

    await queryClient.refetchQueries();

    expect(server.get).toHaveBeenCalledTimes(2);
    expect(source.suggestions()?.[0]).toBe(before);
  });

  it('keeps the earlier set visible while a refresh generates', async () => {
    server.get.mockReturnValue(okAsync(set({})));
    server.refresh.mockReturnValue(okAsync(set({ status: 'generating' })));
    const source = mount();
    await waitFor(() => expect(source.suggestions()).toHaveLength(1));

    await source.refresh();

    expect(source.generating()).toBe(true);
    expect(source.suggestions()).toHaveLength(1);
    expect(source.error()).toBeUndefined();
  });

  it('reports a failed generation only when there is nothing to show', async () => {
    server.get.mockReturnValue(
      okAsync(set({ status: 'failed', suggestions: [], generatedAt: null }))
    );
    const failed = mount();
    await waitFor(() => expect(failed.error()).toBeDefined());
    cleanup();
    queryClient.clear();

    server.get.mockReturnValue(okAsync(set({ status: 'failed' })));
    const stale = mount();
    await waitFor(() => expect(stale.suggestions()).toHaveLength(1));
    expect(stale.error()).toBeUndefined();
  });
});
