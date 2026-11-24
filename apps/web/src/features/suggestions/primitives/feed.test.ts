import { createRoot, createSignal } from 'solid-js';
import { describe, expect, it, vi } from 'vitest';
import type {
  SuggestionActions,
  SuggestionsSource,
} from '../context/suggestions-source';
import type { ForYouList } from '../core/lists';
import type {
  FeedCounts,
  Suggestion,
  SuggestionFeed,
} from '../core/suggestion';
import {
  backgroundSuggestion,
  composerSuggestion,
  doneSuggestion,
  draftedReplySuggestion,
  failedSuggestion,
  quietBackgroundSuggestion as quietSuggestion,
  replySuggestion,
  reviewSuggestion,
  routineSuggestion,
  runningSuggestion,
} from '../tests/fixtures';
import { createSuggestionsFeed, type SuggestionsFeed } from './feed';

/** The drafted reply fixture's draft. */
const DRAFT = {
  entityType: 'email_thread',
  entityId: 'thread-1',
  partId: 'draft-1',
  preview: 'The terms are unchanged; only the price moved.',
};

/** The counts a server would send for `suggestions`. */
function countsOf(suggestions: Suggestion[]): FeedCounts {
  const counts = { open: 0, running: 0, failed: 0, done: 0 };
  for (const suggestion of suggestions) counts[suggestion.status] += 1;

  return counts;
}

function host(suggestions: Suggestion[]) {
  const [feed, setFeed] = createSignal<SuggestionFeed | undefined>({
    suggestions,
    counts: countsOf(suggestions),
  });
  /** The server's next answer lists `list`. */
  const serve = (list: Suggestion[]) =>
    setFeed({ suggestions: list, counts: countsOf(list) });
  /** The server stops listing a suggestion, as after a dismissal. */
  const drop = (id: string) =>
    setFeed((held) => {
      const left = held?.suggestions.filter((other) => other.id !== id) ?? [];
      return { suggestions: left, counts: countsOf(left) };
    });
  const source = {
    feed,
    failed: () => false,
    retry: vi.fn(),
    refresh: vi.fn(async () => {}),
    accept: vi.fn(async (): Promise<'accepted' | 'changed'> => 'accepted'),
    dismiss: vi.fn(async (id: string) => {
      drop(id);
    }),
    stop: vi.fn(async (_id: string) => {}),
    restore: vi.fn(async (_suggestion: Suggestion) => {}),
    viewed: vi.fn(),
  } satisfies SuggestionsSource;
  const actions = {
    openComposer: vi.fn(async () => {}),
    openItem: vi.fn(),
    openDraft: vi.fn(),
    reviewRoutine: vi.fn(),
    turnOnRoutine: vi.fn(async () => {}),
  } satisfies SuggestionActions;

  return { source, actions, serve };
}

function withFeed(
  suggestions: Suggestion[],
  run: (feed: SuggestionsFeed, deps: ReturnType<typeof host>) => Promise<void>
) {
  const deps = host(suggestions);

  return createRoot(async (dispose) => {
    await run(createSuggestionsFeed(deps.source, deps.actions), deps);
    dispose();

    return deps;
  });
}

function entriesOf(feed: SuggestionsFeed, list: ForYouList = 'today') {
  const view = feed.view(list);

  return view.kind === 'rows' ? view.entries : [];
}

function shownIds(feed: SuggestionsFeed, list: ForYouList = 'today') {
  return entriesOf(feed, list).map((entry) => entry.suggestion.id);
}

/** Today's rows, each as its id and how it reads. */
function rowsOf(feed: SuggestionsFeed) {
  return entriesOf(feed).map((entry) => [entry.suggestion.id, entry.state]);
}

function entryOf(feed: SuggestionsFeed, id: string) {
  return entriesOf(feed).find((entry) => entry.suggestion.id === id);
}

describe('suggestions feed', () => {
  it('lists what waits or runs in the server’s order, and Done apart', async () => {
    await withFeed(
      [
        composerSuggestion,
        replySuggestion,
        failedSuggestion,
        runningSuggestion,
        doneSuggestion,
      ],
      async (feed) => {
        expect(shownIds(feed)).toEqual([
          'suggestion-composer',
          'suggestion-reply',
          'suggestion-failed',
          'suggestion-running',
        ]);
        expect(shownIds(feed, 'toDo')).toEqual(['suggestion-reply']);
        expect(shownIds(feed, 'suggestions')).toEqual([
          'suggestion-composer',
          'suggestion-failed',
          'suggestion-running',
        ]);
        expect(shownIds(feed, 'done')).toEqual(['suggestion-done']);
        expect(feed.counts()).toEqual({
          today: 4,
          toDo: 1,
          suggestions: 3,
          done: 1,
        });
      }
    );
  });

  it('keeps a row marked done in place, struck, with Undo that opens it again', async () => {
    await withFeed(
      [composerSuggestion, reviewSuggestion, replySuggestion],
      async (feed, { source, serve }) => {
        source.accept.mockImplementationOnce(async () => {
          serve([
            composerSuggestion,
            replySuggestion,
            { ...reviewSuggestion, status: 'done' },
          ]);
          return 'accepted';
        });
        expect(await feed.markDone(reviewSuggestion)).toBe(true);

        expect(rowsOf(feed)).toEqual([
          ['suggestion-composer', 'open'],
          ['suggestion-review', 'markedDone'],
          ['suggestion-reply', 'open'],
        ]);
        expect(entryOf(feed, 'suggestion-review')?.canUndo).toBe(true);
        // Only waiting rows count; Done has it already.
        expect(feed.counts()).toMatchObject({ today: 2, done: 1 });

        source.restore.mockImplementationOnce(async () => {
          serve([composerSuggestion, reviewSuggestion, replySuggestion]);
        });
        await feed.undoDone(reviewSuggestion);
        expect(source.restore).toHaveBeenCalledWith(
          expect.objectContaining({ id: 'suggestion-review' })
        );
        expect(rowsOf(feed)[1]).toEqual(['suggestion-review', 'open']);
      }
    );
  });

  it('keeps a run that finished during the visit in place, and lists one done before it only in Done', async () => {
    await withFeed(
      [runningSuggestion, composerSuggestion, doneSuggestion],
      async (feed, { serve }) => {
        serve([
          composerSuggestion,
          { ...runningSuggestion, status: 'done' },
          doneSuggestion,
        ]);

        expect(rowsOf(feed)).toEqual([
          ['suggestion-running', 'finished'],
          ['suggestion-composer', 'open'],
        ]);
        expect(entryOf(feed, 'suggestion-running')?.canUndo).toBe(false);
        expect(shownIds(feed, 'done')).toEqual([
          'suggestion-running',
          'suggestion-done',
        ]);
      }
    );
  });

  it('shows a routine suggestion whose routine was saved as on, where it was', async () => {
    await withFeed(
      [routineSuggestion, composerSuggestion],
      async (feed, { source, serve }) => {
        source.refresh.mockImplementationOnce(async () => {
          serve([
            composerSuggestion,
            {
              ...routineSuggestion,
              status: 'done',
              result: { entityType: 'scheduled_action', entityId: 'routine-1' },
            },
          ]);
        });
        expect(await feed.accept(routineSuggestion)).toBe(true);

        expect(rowsOf(feed)).toEqual([
          ['suggestion-routine', 'routineOn'],
          ['suggestion-composer', 'open'],
        ]);
      }
    );
  });

  it('stops a run and keeps the suggestion, which the server opens again', async () => {
    await withFeed([runningSuggestion], async (feed, { source, serve }) => {
      source.stop.mockImplementationOnce(async () => {
        serve([{ ...runningSuggestion, status: 'open' }]);
      });
      await feed.stop(runningSuggestion);

      expect(source.stop).toHaveBeenCalledWith('suggestion-running');
      expect(source.dismiss).not.toHaveBeenCalled();
      expect(rowsOf(feed)).toEqual([['suggestion-running', 'open']]);
    });
  });

  it('marks the row failed when the server refuses to stop its run', async () => {
    await withFeed([runningSuggestion], async (feed, { source }) => {
      source.stop.mockRejectedValueOnce(new Error('refused'));
      await feed.stop(runningSuggestion);

      expect(entryOf(feed, 'suggestion-running')).toMatchObject({
        state: 'running',
        failed: true,
      });
    });
  });

  it('opens the composer with a composer suggestion’s prompt and accepts it', async () => {
    await withFeed([composerSuggestion], async (feed, { source, actions }) => {
      await feed.accept(composerSuggestion);

      expect(actions.openComposer).toHaveBeenCalledWith(
        'Draft a one-page brief for the budget review.'
      );
      expect(source.accept).toHaveBeenCalledWith(composerSuggestion);
    });
  });

  it('starts a background suggestion by accepting it, without opening anything', async () => {
    await withFeed(
      [backgroundSuggestion],
      async (feed, { source, actions }) => {
        await feed.accept(backgroundSuggestion);

        expect(source.accept).toHaveBeenCalledWith(backgroundSuggestion);
        expect(actions.openComposer).not.toHaveBeenCalled();
        expect(actions.openItem).not.toHaveBeenCalled();
      }
    );
  });

  it('starts a run once when Run is pressed twice', async () => {
    const deps = host([backgroundSuggestion]);
    let finish = () => {};
    deps.source.accept.mockImplementation(
      () =>
        new Promise<'accepted'>((resolve) => {
          finish = () => resolve('accepted');
        })
    );

    await createRoot(async (dispose) => {
      const feed = createSuggestionsFeed(deps.source, deps.actions);
      const first = feed.accept(backgroundSuggestion);
      const second = feed.accept(backgroundSuggestion);
      finish();
      await Promise.all([first, second]);
      dispose();
    });

    expect(deps.source.accept).toHaveBeenCalledTimes(1);
  });

  it('marks the card failed when its run could not start, and lets Run try again', async () => {
    const deps = host([backgroundSuggestion]);
    deps.source.accept.mockRejectedValueOnce(new Error('refused'));

    await createRoot(async (dispose) => {
      const feed = createSuggestionsFeed(deps.source, deps.actions);
      const entry = () => {
        const view = feed.view('today');
        if (view.kind !== 'rows') throw new Error('expected rows');

        return view.entries[0];
      };

      await feed.accept(backgroundSuggestion);
      expect(entry()?.failed).toBe(true);

      await feed.accept(backgroundSuggestion);
      expect(entry()?.failed).toBe(false);
      dispose();
    });

    expect(deps.source.accept).toHaveBeenCalledTimes(2);
  });

  it('opens a reply suggestion’s draft when it has one, else the item', async () => {
    await withFeed(
      [draftedReplySuggestion, replySuggestion],
      async (feed, { actions }) => {
        await feed.accept(draftedReplySuggestion);
        expect(actions.openDraft).toHaveBeenCalledWith(DRAFT);
        expect(actions.openItem).not.toHaveBeenCalled();

        await feed.accept(replySuggestion);
        expect(actions.openItem).toHaveBeenCalledWith({
          entityType: 'email_thread',
          entityId: 'thread-1',
        });
      }
    );
  });

  it('shows the new text and takes nothing up when the suggestion changed under the card', async () => {
    const deps = host([backgroundSuggestion]);
    deps.source.accept.mockResolvedValueOnce('changed');

    await createRoot(async (dispose) => {
      const feed = createSuggestionsFeed(deps.source, deps.actions);
      const entry = () => {
        const view = feed.view('today');
        if (view.kind !== 'rows') throw new Error('expected rows');

        return view.entries[0];
      };

      await feed.accept(backgroundSuggestion);
      expect(entry()?.changed).toBe(true);
      expect(entry()?.failed).toBe(false);

      await feed.accept(backgroundSuggestion);
      expect(entry()?.changed).toBe(false);
      dispose();
    });
  });

  it('opens nothing for an suggestion that changed under the card', async () => {
    await withFeed(
      [composerSuggestion, draftedReplySuggestion],
      async (feed, { source, actions }) => {
        source.accept.mockResolvedValue('changed');

        await feed.accept(composerSuggestion);
        await feed.accept(draftedReplySuggestion);

        expect(actions.openComposer).not.toHaveBeenCalled();
        expect(actions.openDraft).not.toHaveBeenCalled();
      }
    );
  });

  it('keeps an opened reply suggestion open while the server does, and accepts it again on the next open', async () => {
    await withFeed([replySuggestion], async (feed, { source, actions }) => {
      await feed.accept(replySuggestion);
      await feed.accept(replySuggestion);

      expect(source.accept).toHaveBeenCalledTimes(2);
      expect(actions.openItem).toHaveBeenCalledTimes(2);
      expect(shownIds(feed)).toEqual(['suggestion-reply']);
    });
  });

  it('opens nothing when the account changed while the accept was out', async () => {
    const deps = host([composerSuggestion]);
    const [viewer, setViewer] = createSignal('user-1');
    deps.source.accept.mockImplementationOnce(async () => {
      setViewer('user-2');
      return 'accepted';
    });

    await createRoot(async (dispose) => {
      const feed = createSuggestionsFeed(deps.source, deps.actions, { viewer });
      await feed.accept(composerSuggestion);
      dispose();
    });

    expect(deps.actions.openComposer).not.toHaveBeenCalled();
  });

  it('marks the card failed when its routine can’t be opened for review', async () => {
    const deps = host([routineSuggestion]);
    deps.actions.reviewRoutine.mockImplementationOnce(() => {
      throw new Error('Routine suggestion is not loaded');
    });

    await createRoot(async (dispose) => {
      const feed = createSuggestionsFeed(deps.source, deps.actions);
      await feed.look(routineSuggestion);

      const view = feed.view('today');
      if (view.kind !== 'rows') throw new Error('expected a feed');
      expect(view.entries[0]?.failed).toBe(true);
      dispose();
    });
  });

  it('turns a routine suggestion on by saving its drafted routine, not by accepting', async () => {
    await withFeed([routineSuggestion], async (feed, { source, actions }) => {
      await feed.accept(routineSuggestion);

      expect(actions.turnOnRoutine).toHaveBeenCalledWith('routine-draft-1');
      expect(source.refresh).toHaveBeenCalledTimes(1);
      expect(source.accept).not.toHaveBeenCalled();
    });
  });

  it('looks at a running suggestion’s session, and at a waiting one’s prompt without taking it up', async () => {
    await withFeed(
      [runningSuggestion, backgroundSuggestion],
      async (feed, { source, actions }) => {
        await feed.look(runningSuggestion);
        expect(actions.openItem).toHaveBeenLastCalledWith({
          entityType: 'agent_session',
          entityId: 'session-1',
        });

        await feed.look(backgroundSuggestion);
        expect(actions.openComposer).toHaveBeenCalledWith(
          'Summarize this week and post it.'
        );
        expect(source.accept).not.toHaveBeenCalled();
      }
    );
  });

  it('opens what a finished run left, and a finished reply’s draft, without accepting', async () => {
    const opened = { ...draftedReplySuggestion, status: 'done' as const };
    await withFeed(
      [doneSuggestion, opened],
      async (feed, { source, actions }) => {
        await feed.open(doneSuggestion);
        expect(actions.openItem).toHaveBeenLastCalledWith({
          entityType: 'document',
          entityId: 'document-1',
        });

        await feed.open(opened);
        expect(actions.openDraft).toHaveBeenCalledWith(DRAFT);
        expect(source.accept).not.toHaveBeenCalled();
      }
    );
  });

  it('opens nothing for a finished run that left nothing', async () => {
    const unsettled: Suggestion = { ...quietSuggestion, status: 'done' };
    await withFeed([unsettled], async (feed, { actions }) => {
      await feed.open(unsettled);

      expect(actions.openItem).not.toHaveBeenCalled();
      expect(actions.openComposer).not.toHaveBeenCalled();
    });
  });

  it('marks a review done by taking it up, without opening anything', async () => {
    await withFeed([reviewSuggestion], async (feed, { source, actions }) => {
      await feed.markDone(reviewSuggestion);

      expect(source.accept).toHaveBeenCalledWith(reviewSuggestion);
      expect(actions.openItem).not.toHaveBeenCalled();
    });
  });

  it('never marks a reply done, since only the person’s reply finishes it', async () => {
    await withFeed([replySuggestion], async (feed, { source }) => {
      await feed.markDone(replySuggestion);

      expect(source.accept).not.toHaveBeenCalled();
    });
  });

  it('never marks a background prompt done, since taking it up starts its run', async () => {
    await withFeed([backgroundSuggestion], async (feed, { source }) => {
      await feed.markDone(backgroundSuggestion);

      expect(source.accept).not.toHaveBeenCalled();
    });
  });

  it('sends a dismissal at once and keeps the suggestion where it was, to undo', async () => {
    await withFeed(
      [composerSuggestion, replySuggestion],
      async (feed, { source }) => {
        await feed.dismiss(composerSuggestion);

        expect(source.dismiss).toHaveBeenCalledWith('suggestion-composer');
        const view = feed.view('today');
        if (view.kind !== 'rows') throw new Error('expected a feed');
        expect(
          view.entries.map((entry) => [entry.suggestion.id, entry.state])
        ).toEqual([
          ['suggestion-composer', 'dismissed'],
          ['suggestion-reply', 'open'],
        ]);
      }
    );
  });

  it('asks the server to restore a dismissal on Undo, then drops its row', async () => {
    await withFeed([composerSuggestion], async (feed, { source }) => {
      await feed.dismiss(composerSuggestion);
      await feed.undoDismiss(composerSuggestion);

      expect(source.restore).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'suggestion-composer' })
      );
      // The row is gone; the restored card comes back with the next read.
      expect(shownIds(feed)).toEqual([]);
    });
  });

  it('keeps the row, marked failed, when the server refuses to restore', async () => {
    const deps = host([composerSuggestion]);
    deps.source.restore.mockRejectedValueOnce(new Error('too late'));

    await createRoot(async (dispose) => {
      const feed = createSuggestionsFeed(deps.source, deps.actions);
      await feed.dismiss(composerSuggestion);
      await feed.undoDismiss(composerSuggestion);

      const view = feed.view('today');
      if (view.kind !== 'rows') throw new Error('expected a feed');
      expect(view.entries[0]).toMatchObject({
        state: 'dismissed',
        failed: true,
      });
      dispose();
    });
  });

  it('shows a row dismissed from the press, while the feed drops it before the server answers', async () => {
    await withFeed([composerSuggestion], async (feed, { source, serve }) => {
      let answer: () => void = () => {};
      source.dismiss.mockImplementationOnce(
        () =>
          new Promise<void>((resolve) => {
            answer = resolve;
          })
      );
      const sent = feed.dismiss(composerSuggestion);
      // The feed no longer lists it while the dismissal is still answering.
      serve([]);
      await source.refresh();

      expect(rowsOf(feed)).toEqual([['suggestion-composer', 'dismissed']]);
      answer();
      await sent;
      expect(rowsOf(feed)).toEqual([['suggestion-composer', 'dismissed']]);
    });
  });

  it('keeps a row dismissed, with Undo, when the feed dropped it before its dismissal failed', async () => {
    await withFeed([composerSuggestion], async (feed, { source, serve }) => {
      let fail: (error: Error) => void = () => {};
      source.dismiss.mockImplementationOnce(
        () =>
          new Promise<void>((_resolve, reject) => {
            fail = reject;
          })
      );
      const sent = feed.dismiss(composerSuggestion);
      // The server took the dismissal (a poll no longer lists it), and only
      // its answer was lost.
      serve([]);
      fail(new Error('connection lost'));
      await sent;

      expect(entryOf(feed, 'suggestion-composer')).toMatchObject({
        state: 'dismissed',
        failed: false,
      });
    });
  });

  it('keeps a row dismissed when its dismissal failed but the feed read after it no longer lists it', async () => {
    await withFeed([composerSuggestion], async (feed, { source, serve }) => {
      source.dismiss.mockRejectedValueOnce(new Error('connection lost'));
      source.refresh.mockImplementationOnce(async () => {
        serve([]);
      });

      await feed.dismiss(composerSuggestion);

      expect(entryOf(feed, 'suggestion-composer')).toMatchObject({
        state: 'dismissed',
        failed: false,
      });
    });
  });

  it('shows what a run left when it finished before its dismissal reached the server', async () => {
    await withFeed([runningSuggestion], async (feed, { source, serve }) => {
      source.dismiss.mockRejectedValueOnce(new Error('not found'));
      source.refresh.mockImplementationOnce(async () => {
        serve([{ ...runningSuggestion, status: 'done' }]);
      });

      await feed.dismiss(runningSuggestion);

      expect(entryOf(feed, 'suggestion-running')).toMatchObject({
        state: 'finished',
        failed: false,
      });
    });
  });

  it('leaves the card, marked failed, when the server refused its dismissal', async () => {
    const deps = host([composerSuggestion]);
    deps.source.dismiss.mockRejectedValueOnce(new Error('refused'));

    await createRoot(async (dispose) => {
      const feed = createSuggestionsFeed(deps.source, deps.actions);
      await feed.dismiss(composerSuggestion);

      const view = feed.view('today');
      if (view.kind !== 'rows') throw new Error('expected a feed');
      expect(view.entries[0]).toMatchObject({ state: 'open', failed: true });
      dispose();
    });
  });
});
