import { routineSuggestionKeys } from '@app/features/routine-suggestions/queries/keys';
import { fireAndForget } from '@core/util/fireAndForget';
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
import { suggestionsKeys } from './keys';
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
  /** The dismissal call fails (its answer lost, or refused). */
  dismissFails: false,
  /** What an accept answers: the suggestion as it is now. */
  acceptChanged: undefined as WireSuggestion | undefined,
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
    acceptSuggestion: async () => ok({ changed: server.acceptChanged ?? null }),
    dismissSuggestion: async () =>
      server.dismissFails
        ? err([{ code: 'HTTP_ERROR', message: 'connection lost' }])
        : ok(undefined),
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
  server.dismissFails = false;
  server.acceptChanged = undefined;
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

  await waitFor(() =>
    expect(source.feed()?.suggestions[0]?.status).toBe('open')
  );
});

it('holds a write until the read that replaced its own answers', async () => {
  const { source } = mount();
  await waitFor(() => expect(source.feed()).toBeDefined());
  // The write's read never answers: Undo's read replaces it, and answers
  // when released.
  server.gates.push(new Promise<void>(() => {}));
  let release: () => void = () => {};
  server.gates.push(
    new Promise<void>((resolve) => {
      release = resolve;
    })
  );
  let settled = false;
  const waiting = (async () => {
    await source.refresh();
    settled = true;
  })();
  await waitFor(() => expect(server.gates).toHaveLength(1));

  await source.restore(decoded(DONE));
  await new Promise((resolve) => setTimeout(resolve, 30));
  expect(settled).toBe(false);

  release();
  await waiting;
  expect(settled).toBe(true);
});

it('holds a write through two reads that replaced its own', async () => {
  const { source } = mount();
  await waitFor(() => expect(source.feed()).toBeDefined());
  // The write's read and Undo's never answer; a third write's read
  // replaces Undo's and answers when released.
  server.gates.push(new Promise<void>(() => {}));
  server.gates.push(new Promise<void>(() => {}));
  let release: () => void = () => {};
  server.gates.push(
    new Promise<void>((resolve) => {
      release = resolve;
    })
  );
  let settled = false;
  const waiting = (async () => {
    await source.refresh();
    settled = true;
  })();
  await waitFor(() => expect(server.gates).toHaveLength(2));
  await source.restore(decoded(DONE));
  await waitFor(() => expect(server.gates).toHaveLength(1));
  const third = source.refresh();
  await new Promise((resolve) => setTimeout(resolve, 30));
  expect(settled).toBe(false);

  release();
  await Promise.all([waiting, third]);
  expect(settled).toBe(true);
});

it('lets a write go without waiting on a poll that started after its read', async () => {
  const { client, source } = mount();
  await waitFor(() => expect(source.feed()).toBeDefined());
  // Home's rows are slow to answer; a poll of the feed goes out meanwhile
  // and never answers.
  let releaseHome: () => void = () => {};
  const home = new QueryObserver(client, {
    queryKey: suggestionsKeys.top('user-1', 5).queryKey,
    queryFn: () =>
      new Promise<string[]>((resolve) => {
        releaseHome = () => resolve(['row']);
      }),
  });
  const stop = home.subscribe(() => {});
  await waitFor(() =>
    expect(home.getCurrentResult().fetchStatus).toBe('fetching')
  );
  releaseHome();
  await waitFor(() => expect(home.getCurrentResult().data).toEqual(['row']));

  let settled = false;
  const waiting = (async () => {
    await source.refresh();
    settled = true;
  })();
  await waitFor(() =>
    expect(home.getCurrentResult().fetchStatus).toBe('fetching')
  );
  const feedKey = suggestionsKeys.feed('user-1').queryKey;
  await waitFor(() =>
    expect(client.getQueryState(feedKey)?.fetchStatus).toBe('idle')
  );
  server.gates.push(new Promise<void>(() => {}));
  fireAndForget(
    client.refetchQueries(
      {
        queryKey: feedKey,
        exact: true,
      },
      { cancelRefetch: false }
    ),
    'test.poll'
  );
  await waitFor(() => expect(server.gates).toHaveLength(0));
  releaseHome();

  await waiting;
  expect(settled).toBe(true);
  stop();
});

it('lets a write go without waiting on a read a later write started after its own answered', async () => {
  const { client, source } = mount();
  await waitFor(() => expect(source.feed()).toBeDefined());
  // Home's rows are slow to answer; a later write's read of the feed goes
  // out meanwhile and never answers.
  let releaseHome: () => void = () => {};
  const home = new QueryObserver(client, {
    queryKey: suggestionsKeys.top('user-1', 5).queryKey,
    queryFn: () =>
      new Promise<string[]>((resolve) => {
        releaseHome = () => resolve(['row']);
      }),
  });
  const stop = home.subscribe(() => {});
  await waitFor(() =>
    expect(home.getCurrentResult().fetchStatus).toBe('fetching')
  );
  releaseHome();
  await waitFor(() => expect(home.getCurrentResult().data).toEqual(['row']));

  let settled = false;
  const waiting = (async () => {
    await source.refresh();
    settled = true;
  })();
  await waitFor(() =>
    expect(home.getCurrentResult().fetchStatus).toBe('fetching')
  );
  const feedKey = suggestionsKeys.feed('user-1').queryKey;
  await waitFor(() =>
    expect(client.getQueryState(feedKey)?.fetchStatus).toBe('idle')
  );
  server.gates.push(new Promise<void>(() => {}));
  fireAndForget(source.refresh(), 'test.later');
  await waitFor(() => expect(server.gates).toHaveLength(0));
  releaseHome();

  await waiting;
  expect(settled).toBe(true);
  stop();
});

it('leaves a restored suggestion as a later write left it when the read after the restore fails', async () => {
  const { source } = mount();
  await waitFor(() =>
    expect(source.feed()?.suggestions[0]?.status).toBe('done')
  );
  let release: () => void = () => {};
  server.gates.push(
    new Promise<void>((resolve) => {
      release = resolve;
    })
  );
  server.feedFails = true;
  await source.restore(decoded(DONE));
  // Taken up again before the read after the restore answers; the server
  // answers with it done.
  server.acceptChanged = { ...DONE, updatedAt: '2026-11-09T09:00:00Z' };
  await source.accept(decoded({ ...DONE, status: 'open' }));
  await waitFor(() =>
    expect(source.feed()?.suggestions[0]?.status).toBe('done')
  );

  release();
  await new Promise((resolve) => setTimeout(resolve, 30));

  expect(source.feed()?.suggestions[0]?.status).toBe('done');
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

it('reads routine ideas again when a dismissal fails, which may have taken one', async () => {
  const { client, source } = mount();
  await waitFor(() => expect(source.feed()).toBeDefined());
  const read = vi.fn<() => Promise<string[]>>().mockResolvedValue(['idea']);
  const ideas = new QueryObserver(client, {
    queryKey: routineSuggestionKeys.all.queryKey,
    queryFn: read,
  });
  const stop = ideas.subscribe(() => {});
  await waitFor(() => expect(ideas.getCurrentResult().data).toEqual(['idea']));
  server.dismissFails = true;

  const sent = await ResultAsync.fromPromise(
    source.dismiss('suggestion-1'),
    (error) => error
  );

  expect(sent.isErr()).toBe(true);
  await waitFor(() => expect(read).toHaveBeenCalledTimes(2));
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
