import { createRoot, createSignal } from 'solid-js';
import { describe, expect, it, vi } from 'vitest';
import type {
  SuggestionActions,
  SuggestionsSource,
} from '../context/suggestions-source';
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
    restore: vi.fn(async (_id: string) => {}),
    viewed: vi.fn(),
  } satisfies SuggestionsSource;
  const actions = {
    openComposer: vi.fn(async () => {}),
    openItem: vi.fn(),
    openDraft: vi.fn(),
    reviewRoutine: vi.fn(),
    turnOnRoutine: vi.fn(async () => {}),
  } satisfies SuggestionActions;

  return { source, actions };
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

function shownIds(feed: SuggestionsFeed) {
  const view = feed.view();

  return view.kind === 'suggestions'
    ? view.entries.map((entry) => entry.suggestion.id)
    : [];
}

describe('suggestions feed', () => {
  it('shows the server’s order and counts as they are, with a failed run counted under Running', async () => {
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
          'suggestion-done',
        ]);
        expect(feed.counts()).toEqual({ all: 5, running: 2, open: 2, done: 1 });

        feed.setFilter('running');
        expect(shownIds(feed)).toEqual([
          'suggestion-failed',
          'suggestion-running',
        ]);
      }
    );
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
        const view = feed.view();
        if (view.kind !== 'suggestions')
          throw new Error('expected suggestions');

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
        const view = feed.view();
        if (view.kind !== 'suggestions')
          throw new Error('expected suggestions');

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

  it('lists an opened suggestion as done once the server says so, and opens it again without accepting', async () => {
    const opened = { ...draftedReplySuggestion, status: 'done' as const };
    await withFeed(
      [replySuggestion, opened],
      async (feed, { source, actions }) => {
        expect(shownIds(feed)).toEqual(['suggestion-reply', opened.id]);
        expect(feed.counts()).toEqual({ all: 2, running: 0, open: 1, done: 1 });

        feed.open(opened);
        expect(actions.openDraft).toHaveBeenCalledWith(DRAFT);
        expect(source.accept).not.toHaveBeenCalled();
      }
    );
  });

  it('turns a routine suggestion on by saving its drafted routine, not by accepting', async () => {
    await withFeed([routineSuggestion], async (feed, { source, actions }) => {
      await feed.accept(routineSuggestion);

      expect(actions.turnOnRoutine).toHaveBeenCalledWith('routine-draft-1');
      expect(source.refresh).toHaveBeenCalledTimes(1);
      expect(source.accept).not.toHaveBeenCalled();
    });
  });

  it('opens what the server says a finished run left, and a running one’s session', async () => {
    await withFeed(
      [runningSuggestion, doneSuggestion],
      async (feed, { actions }) => {
        feed.open(doneSuggestion);
        expect(actions.openItem).toHaveBeenLastCalledWith({
          entityType: 'document',
          entityId: 'document-1',
        });

        feed.open(runningSuggestion);
        expect(actions.openItem).toHaveBeenLastCalledWith({
          entityType: 'agent_session',
          entityId: 'session-1',
        });
      }
    );
  });

  it('opens nothing for a finished suggestion that left nothing', async () => {
    const unsettled: Suggestion = {
      ...quietSuggestion,
      status: 'done',
    };
    await withFeed([unsettled], async (feed, { actions }) => {
      feed.open(unsettled);

      expect(actions.openItem).not.toHaveBeenCalled();
    });
  });

  it('sends a dismissal at once and keeps the suggestion as a row to undo', async () => {
    await withFeed(
      [composerSuggestion, replySuggestion],
      async (feed, { source }) => {
        await feed.dismiss(composerSuggestion);

        expect(source.dismiss).toHaveBeenCalledWith('suggestion-composer');
        const view = feed.view();
        if (view.kind !== 'suggestions') throw new Error('expected a feed');
        expect(
          view.entries.map((entry) => [entry.suggestion.id, entry.dismissed])
        ).toEqual([
          ['suggestion-reply', false],
          ['suggestion-composer', true],
        ]);
        expect(feed.counts().all).toBe(1);
      }
    );
  });

  it('asks the server to restore a dismissal on Undo, then drops its row', async () => {
    await withFeed([composerSuggestion], async (feed, { source }) => {
      await feed.dismiss(composerSuggestion);
      await feed.undoDismiss(composerSuggestion);

      expect(source.restore).toHaveBeenCalledWith('suggestion-composer');
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

      const view = feed.view();
      if (view.kind !== 'suggestions') throw new Error('expected a feed');
      expect(view.entries[0]).toMatchObject({ dismissed: true, failed: true });
      dispose();
    });
  });

  it('leaves the card, marked failed, when the server refused its dismissal', async () => {
    const deps = host([composerSuggestion]);
    deps.source.dismiss.mockRejectedValueOnce(new Error('refused'));

    await createRoot(async (dispose) => {
      const feed = createSuggestionsFeed(deps.source, deps.actions);
      await feed.dismiss(composerSuggestion);

      const view = feed.view();
      if (view.kind !== 'suggestions') throw new Error('expected a feed');
      expect(view.entries[0]).toMatchObject({ dismissed: false, failed: true });
      dispose();
    });
  });
});
