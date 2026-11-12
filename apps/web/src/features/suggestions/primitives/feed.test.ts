import { createRoot, createSignal } from 'solid-js';
import { describe, expect, it, vi } from 'vitest';
import type {
  SuggestionActions,
  SuggestionsSource,
} from '../context/suggestions-source';
import type { Suggestion } from '../core/suggestion';
import {
  backgroundSuggestion,
  composerSuggestion,
  doneSuggestion,
  draftedReplySuggestion,
  failedSuggestion,
  replySuggestion,
  routineSuggestion,
  runningSuggestion,
} from '../tests/fixtures';
import { createSuggestionsFeed, type SuggestionsFeed } from './feed';

function host(suggestions: Suggestion[]) {
  const [list] = createSignal<Suggestion[] | undefined>(suggestions);
  const source = {
    suggestions: list,
    failed: () => false,
    retry: vi.fn(),
    refresh: vi.fn(async () => {}),
    accept: vi.fn(async (): Promise<'accepted' | 'changed'> => 'accepted'),
    dismiss: vi.fn(async () => {}),
  } satisfies SuggestionsSource;
  const actions = {
    openComposer: vi.fn(async () => {}),
    openItem: vi.fn(),
    openDraft: vi.fn(),
    routineText: () => undefined,
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
  it('keeps the server’s order, most important first, with done suggestions last', async () => {
    await withFeed(
      [
        composerSuggestion,
        doneSuggestion,
        replySuggestion,
        failedSuggestion,
        runningSuggestion,
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
        expect(actions.openDraft).toHaveBeenCalledWith({
          entityType: 'email_thread',
          entityId: 'thread-1',
          partId: 'draft-1',
        });
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

  it('keeps Run on a background suggestion someone took on for the person without starting it', async () => {
    const takenOn = { ...backgroundSuggestion, state: 'accepted' as const };
    await withFeed([takenOn], async (feed, { source }) => {
      expect(feed.counts()).toEqual({ all: 1, running: 0, open: 1, done: 0 });

      await feed.accept(takenOn);
      expect(source.accept).toHaveBeenCalledWith(takenOn);
    });
  });

  it('lists an opened suggestion as done once the server says so, and opens it again without accepting', async () => {
    const opened = { ...draftedReplySuggestion, state: 'done' as const };
    await withFeed(
      [opened, replySuggestion],
      async (feed, { source, actions }) => {
        expect(shownIds(feed)).toEqual(['suggestion-reply', opened.id]);
        expect(feed.counts()).toEqual({ all: 2, running: 0, open: 1, done: 1 });

        feed.open(opened);
        expect(actions.openDraft).toHaveBeenCalledWith({
          entityType: 'email_thread',
          entityId: 'thread-1',
          partId: 'draft-1',
        });
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

  it('opens what a finished run made', async () => {
    await withFeed([doneSuggestion], async (feed, { actions }) => {
      feed.open(doneSuggestion);

      expect(actions.openItem).toHaveBeenCalledWith({
        entityType: 'document',
        entityId: 'document-1',
      });
    });
  });

  it('holds a dismissal for Undo and sends only what is still dismissed on leaving', async () => {
    const { source } = await withFeed(
      [composerSuggestion, replySuggestion],
      async (feed, { source }) => {
        feed.dismiss(composerSuggestion);
        feed.dismiss(replySuggestion);
        expect(feed.counts().all).toBe(0);
        expect(source.dismiss).not.toHaveBeenCalled();

        feed.undoDismiss(composerSuggestion);
        expect(feed.counts().all).toBe(1);
      }
    );

    expect(source.dismiss).toHaveBeenCalledTimes(1);
    expect(source.dismiss).toHaveBeenCalledWith('suggestion-reply', {
      leaving: false,
    });
  });

  it('sends held dismissals once when the page goes away', async () => {
    const { source } = await withFeed([composerSuggestion], async (feed) => {
      feed.dismiss(composerSuggestion);
      feed.sendDismissals();
    });

    expect(source.dismiss).toHaveBeenCalledTimes(1);
    expect(source.dismiss).toHaveBeenCalledWith('suggestion-composer', {
      leaving: true,
    });
  });

  it('sends a dismissal by itself once the Undo window passes, and not one that was undone', async () => {
    vi.useFakeTimers();
    const deps = host([composerSuggestion, replySuggestion]);

    await createRoot(async (dispose) => {
      const feed = createSuggestionsFeed(deps.source, deps.actions, {
        undoMs: 8000,
      });
      feed.dismiss(composerSuggestion);
      feed.dismiss(replySuggestion);
      feed.undoDismiss(replySuggestion);

      vi.advanceTimersByTime(7999);
      expect(deps.source.dismiss).not.toHaveBeenCalled();

      vi.advanceTimersByTime(1);
      expect(deps.source.dismiss).toHaveBeenCalledTimes(1);
      expect(deps.source.dismiss).toHaveBeenCalledWith('suggestion-composer', {
        leaving: false,
      });
      // Sent: gone from the feed without waiting for the next read.
      expect(shownIds(feed)).toEqual(['suggestion-reply']);
      dispose();
    });

    expect(deps.source.dismiss).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });

  it('puts an suggestion back when the server refused its dismissal', async () => {
    const deps = host([composerSuggestion]);
    deps.source.dismiss.mockRejectedValueOnce(new Error('refused'));

    await createRoot(async (dispose) => {
      const feed = createSuggestionsFeed(deps.source, deps.actions);
      feed.dismiss(composerSuggestion);
      feed.sendDismissals();
      expect(shownIds(feed)).toEqual([]);

      await Promise.resolve();
      await Promise.resolve();
      expect(shownIds(feed)).toEqual(['suggestion-composer']);
      dispose();
    });
  });
});
