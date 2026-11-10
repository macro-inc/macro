import { createRoot, createSignal } from 'solid-js';
import { describe, expect, it, vi } from 'vitest';
import type { IdeaActions, IdeasSource } from '../context/ideas-source';
import type { Idea } from '../core/idea';
import {
  backgroundIdea,
  composerIdea,
  doneIdea,
  draftedReplyIdea,
  failedIdea,
  replyIdea,
  routineIdea,
  runningIdea,
} from '../tests/fixtures';
import { createIdeasFeed, type IdeasFeed } from './feed';

function host(ideas: Idea[]) {
  const [list] = createSignal<Idea[] | undefined>(ideas);
  const source = {
    ideas: list,
    failed: () => false,
    retry: vi.fn(),
    refresh: vi.fn(async () => {}),
    accept: vi.fn(async () => {}),
    dismiss: vi.fn(async () => {}),
  } satisfies IdeasSource;
  const actions = {
    openComposer: vi.fn(async () => {}),
    openItem: vi.fn(),
    openDraft: vi.fn(),
    routineText: () => undefined,
    reviewRoutine: vi.fn(),
    turnOnRoutine: vi.fn(async () => {}),
  } satisfies IdeaActions;

  return { source, actions };
}

function withFeed(
  ideas: Idea[],
  run: (feed: IdeasFeed, deps: ReturnType<typeof host>) => Promise<void>
) {
  const deps = host(ideas);

  return createRoot(async (dispose) => {
    await run(createIdeasFeed(deps.source, deps.actions), deps);
    dispose();

    return deps;
  });
}

function shownIds(feed: IdeasFeed) {
  const view = feed.view();

  return view.kind === 'ideas'
    ? view.entries.map((entry) => entry.idea.id)
    : [];
}

describe('ideas feed', () => {
  it('shows running and failed runs first, then open ideas, then done ones', async () => {
    await withFeed(
      [composerIdea, doneIdea, replyIdea, failedIdea, runningIdea],
      async (feed) => {
        expect(shownIds(feed)).toEqual([
          'idea-failed',
          'idea-running',
          'idea-composer',
          'idea-reply',
          'idea-done',
        ]);
        expect(feed.counts()).toEqual({ all: 5, running: 2, open: 2, done: 1 });

        feed.setFilter('running');
        expect(shownIds(feed)).toEqual(['idea-failed', 'idea-running']);
      }
    );
  });

  it('opens the composer with a composer idea’s prompt and accepts it', async () => {
    await withFeed([composerIdea], async (feed, { source, actions }) => {
      await feed.accept(composerIdea);

      expect(actions.openComposer).toHaveBeenCalledWith(
        'Draft a one-page brief for the budget review.'
      );
      expect(source.accept).toHaveBeenCalledWith('idea-composer');
    });
  });

  it('starts a background idea by accepting it, without opening anything', async () => {
    await withFeed([backgroundIdea], async (feed, { source, actions }) => {
      await feed.accept(backgroundIdea);

      expect(source.accept).toHaveBeenCalledWith('idea-background');
      expect(actions.openComposer).not.toHaveBeenCalled();
      expect(actions.openItem).not.toHaveBeenCalled();
    });
  });

  it('starts a run once when Run is pressed twice', async () => {
    const deps = host([backgroundIdea]);
    let finish = () => {};
    deps.source.accept.mockImplementation(
      () => new Promise<void>((resolve) => (finish = resolve))
    );

    await createRoot(async (dispose) => {
      const feed = createIdeasFeed(deps.source, deps.actions);
      const first = feed.accept(backgroundIdea);
      const second = feed.accept(backgroundIdea);
      finish();
      await Promise.all([first, second]);
      dispose();
    });

    expect(deps.source.accept).toHaveBeenCalledTimes(1);
  });

  it('marks the card failed when its run could not start, and lets Run try again', async () => {
    const deps = host([backgroundIdea]);
    deps.source.accept.mockRejectedValueOnce(new Error('refused'));

    await createRoot(async (dispose) => {
      const feed = createIdeasFeed(deps.source, deps.actions);
      const entry = () => {
        const view = feed.view();
        if (view.kind !== 'ideas') throw new Error('expected ideas');

        return view.entries[0];
      };

      await feed.accept(backgroundIdea);
      expect(entry()?.failed).toBe(true);

      await feed.accept(backgroundIdea);
      expect(entry()?.failed).toBe(false);
      dispose();
    });

    expect(deps.source.accept).toHaveBeenCalledTimes(2);
  });

  it('opens a reply idea’s draft when it has one, else the item', async () => {
    await withFeed([draftedReplyIdea, replyIdea], async (feed, { actions }) => {
      await feed.accept(draftedReplyIdea);
      expect(actions.openDraft).toHaveBeenCalledWith({
        entityType: 'email_thread',
        entityId: 'thread-1',
        partId: 'draft-1',
      });
      expect(actions.openItem).not.toHaveBeenCalled();

      await feed.accept(replyIdea);
      expect(actions.openItem).toHaveBeenCalledWith({
        entityType: 'email_thread',
        entityId: 'thread-1',
      });
    });
  });

  it('turns a routine idea on by saving its suggestion, not by accepting', async () => {
    await withFeed([routineIdea], async (feed, { source, actions }) => {
      await feed.accept(routineIdea);

      expect(actions.turnOnRoutine).toHaveBeenCalledWith('suggestion-1');
      expect(source.refresh).toHaveBeenCalledTimes(1);
      expect(source.accept).not.toHaveBeenCalled();
    });
  });

  it('opens what a finished run made', async () => {
    await withFeed([doneIdea], async (feed, { actions }) => {
      feed.open(doneIdea);

      expect(actions.openItem).toHaveBeenCalledWith({
        entityType: 'document',
        entityId: 'document-1',
      });
    });
  });

  it('holds a dismissal for Undo and sends only what is still dismissed on leaving', async () => {
    const { source } = await withFeed(
      [composerIdea, replyIdea],
      async (feed, { source }) => {
        feed.dismiss(composerIdea);
        feed.dismiss(replyIdea);
        expect(feed.counts().all).toBe(0);
        expect(source.dismiss).not.toHaveBeenCalled();

        feed.undoDismiss(composerIdea);
        expect(feed.counts().all).toBe(1);
      }
    );

    expect(source.dismiss).toHaveBeenCalledTimes(1);
    expect(source.dismiss).toHaveBeenCalledWith('idea-reply', {
      leaving: false,
    });
  });

  it('sends held dismissals once when the page goes away', async () => {
    const { source } = await withFeed([composerIdea], async (feed) => {
      feed.dismiss(composerIdea);
      feed.sendDismissals();
    });

    expect(source.dismiss).toHaveBeenCalledTimes(1);
    expect(source.dismiss).toHaveBeenCalledWith('idea-composer', {
      leaving: true,
    });
  });
});
