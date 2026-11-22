import { routineSuggestionKeys } from '@app/features/routine-suggestions/queries/keys';
import type { Suggestion as WireSuggestion } from '@service-scheduled-action/generated/schemas';
import { renderHook, waitFor } from '@solidjs/testing-library';
import { QueryClient, QueryClientProvider } from '@tanstack/solid-query';
import { err, ok } from 'neverthrow';
import type { ParentProps } from 'solid-js';
import { beforeEach, expect, it, vi } from 'vitest';
import { useSuggestionsSource } from './suggestions-source';

const DONE: WireSuggestion = {
  id: 'suggestion-1',
  title: 'Review the vendor contract',
  summary: 'Renewal terms changed.',
  importance: 80,
  dedupKey: 'vendor-contract',
  categories: [],
  state: 'accepted',
  status: 'done',
  isNew: false,
  createdAt: '2026-11-09T06:00:00Z',
  stateChangedAt: '2026-11-09T08:00:00Z',
  updatedAt: '2026-11-09T08:00:00Z',
  about: [{ entityType: 'document', entityId: 'document-1', partId: null }],
  produced: [],
  kind: 'entity',
  action: 'review',
};
const COUNTS = { open: 0, running: 0, failed: 0, done: 1 };

const server = vi.hoisted(() => ({ feedFails: false }));

vi.mock('@service-scheduled-action/client', () => ({
  scheduledActionClient: {
    suggestionGeneration: async () => ok({ state: 'idle' }),
    listSuggestions: async () =>
      server.feedFails
        ? err([{ code: 'HTTP_ERROR', message: 'unavailable' }])
        : ok({ suggestions: [], done: [DONE], counts: COUNTS }),
    restoreSuggestion: async () => ok(undefined),
    dismissSuggestion: async () => ok(undefined),
  },
}));
vi.mock('../use-suggestions-flag', () => ({
  useSuggestionsFlag: () => () => true,
}));
vi.mock('@core/context/user', () => ({ useUserId: () => () => 'user-1' }));

function mount() {
  const client = new QueryClient({
    defaultOptions: {
      queries: { refetchOnWindowFocus: false, retry: false },
    },
  });
  const wrapper = (props: ParentProps) => (
    <QueryClientProvider client={client}>{props.children}</QueryClientProvider>
  );
  const { result } = renderHook(() => useSuggestionsSource(), { wrapper });

  return { client, source: result };
}

beforeEach(() => {
  server.feedFails = false;
});

it('shows a restored suggestion open even when the read after the restore fails', async () => {
  const { source } = mount();
  await waitFor(() =>
    expect(source.feed()?.suggestions[0]?.status).toBe('done')
  );

  server.feedFails = true;
  await source.restore('suggestion-1');

  expect(source.feed()?.suggestions[0]?.status).toBe('open');
});

it('reads routine ideas again after a dismissal, which can take an idea with it', async () => {
  const { client, source } = mount();
  client.setQueryData(routineSuggestionKeys.all.queryKey, []);
  await waitFor(() => expect(source.feed()).toBeDefined());

  await source.dismiss('suggestion-1');

  expect(
    client.getQueryState(routineSuggestionKeys.all.queryKey)?.isInvalidated
  ).toBe(true);
});
