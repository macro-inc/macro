import { routineSuggestionKeys } from '@app/features/routine-suggestions/queries/keys';
import type { Suggestion as WireSuggestion } from '@service-scheduled-action/generated/schemas';
import { renderHook, waitFor } from '@solidjs/testing-library';
import {
  QueryClient,
  QueryClientProvider,
  QueryObserver,
} from '@tanstack/solid-query';
import { err, ok, ResultAsync } from 'neverthrow';
import type { ParentProps } from 'solid-js';
import { beforeEach, expect, it, vi } from 'vitest';
import type { Suggestion } from '../core/suggestion';
import { toSuggestion } from './decode';
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

const server = vi.hoisted(() => ({
  feedFails: false,
  listed: undefined as WireSuggestion[] | undefined,
  /** The next feed reads, in turn, wait on these before they answer. */
  gates: [] as Promise<void>[],
  /** Runs as the server answers a restore. */
  onRestore: undefined as (() => void) | undefined,
}));

vi.mock('@service-scheduled-action/client', () => ({
  scheduledActionClient: {
    suggestionGeneration: async () => ok({ state: 'idle' }),
    listSuggestions: async () => {
      const failing = server.feedFails;
      const listed = server.listed;
      await server.gates.shift();
      return failing
        ? err([{ code: 'HTTP_ERROR', message: 'unavailable' }])
        : ok({
            suggestions: [],
            done: listed ?? [DONE],
            counts: COUNTS,
          });
    },
    restoreSuggestion: async () => {
      server.onRestore?.();
      return ok(undefined);
    },
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

/** A wire suggestion as the row held it. */
function decoded(wire: WireSuggestion): Suggestion {
  const suggestion = toSuggestion(wire);
  if (!suggestion) throw new Error('undecodable fixture');
  return suggestion;
}

beforeEach(() => {
  server.feedFails = false;
  server.listed = undefined;
  server.gates = [];
  server.onRestore = undefined;
});

it('shows a restored suggestion open even when the read after the restore fails', async () => {
  const { source } = mount();
  await waitFor(() =>
    expect(source.feed()?.suggestions[0]?.status).toBe('done')
  );

  server.feedFails = true;
  await source.restore(decoded(DONE));

  expect(source.feed()?.suggestions[0]?.status).toBe('open');
});

it('puts a restored dismissal back in the feed, open, when the read after it fails', async () => {
  server.listed = [];
  const { source } = mount();
  await waitFor(() => expect(source.feed()?.suggestions).toEqual([]));

  server.feedFails = true;
  await source.restore(decoded({ ...DONE, state: 'dismissed' }));

  expect(source.feed()?.suggestions).toMatchObject([
    { id: 'suggestion-1', status: 'open' },
  ]);
});

it('shows a restored suggestion open before the read after the restore answers', async () => {
  const { source } = mount();
  await waitFor(() =>
    expect(source.feed()?.suggestions[0]?.status).toBe('done')
  );

  server.gates.push(new Promise<void>(() => {}));
  await source.restore(decoded(DONE));

  expect(source.feed()?.suggestions[0]?.status).toBe('open');
});

it('keeps a restored suggestion open over a read that answered just before the restore', async () => {
  const { source } = mount();
  await waitFor(() =>
    expect(source.feed()?.suggestions[0]?.status).toBe('done')
  );
  // A read goes out before the restore, and answers (still done) as the
  // server takes the restore; the read after it fails.
  let release: () => void = () => {};
  server.gates.push(
    new Promise<void>((resolve) => {
      release = resolve;
    })
  );
  const before = source.refresh();
  server.onRestore = () => {
    release();
    server.feedFails = true;
  };

  await source.restore(decoded(DONE));
  await before;
  await waitFor(() => expect(source.feed()).toBeDefined());

  expect(source.feed()?.suggestions[0]?.status).toBe('open');
});

it('reads routine ideas again after a dismissal, without holding the dismissal for it', async () => {
  const { client, source } = mount();
  await waitFor(() => expect(source.feed()).toBeDefined());
  // The sidebar reads the ideas: the first answer comes at once, the one
  // after the dismissal never does.
  const read = vi
    .fn<() => Promise<string[]>>()
    .mockResolvedValueOnce(['idea'])
    .mockReturnValue(new Promise<string[]>(() => {}));
  const ideas = new QueryObserver(client, {
    queryKey: routineSuggestionKeys.all.queryKey,
    queryFn: read,
  });
  const stop = ideas.subscribe(() => {});
  await waitFor(() => expect(ideas.getCurrentResult().data).toEqual(['idea']));

  await source.dismiss('suggestion-1');

  await waitFor(() => expect(read).toHaveBeenCalledTimes(2));
  expect(ideas.getCurrentResult().fetchStatus).toBe('fetching');
  stop();
});

it('drops a read of the routine ideas that was out before the dismissal', async () => {
  const { client, source } = mount();
  await waitFor(() => expect(source.feed()).toBeDefined());
  let answer: (ideas: string[]) => void = () => {};
  // Cancelled by the dismissal, so it settles as an error.
  const before = ResultAsync.fromPromise(
    client.fetchQuery({
      queryKey: routineSuggestionKeys.all.queryKey,
      queryFn: () =>
        new Promise<string[]>((resolve) => {
          answer = resolve;
        }),
    }),
    (error) => error
  );

  await source.dismiss('suggestion-1');
  // The read answers with the ideas as they were before the dismissal.
  answer(['dismissed idea']);
  await before;

  await waitFor(() =>
    expect(
      client.getQueryState(routineSuggestionKeys.all.queryKey)?.isInvalidated
    ).toBe(true)
  );
  expect(client.getQueryData(routineSuggestionKeys.all.queryKey)).not.toEqual([
    'dismissed idea',
  ]);
});
