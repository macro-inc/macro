import { debounce } from '@core/util/debounce';
import { fireAndForget } from '@core/util/fireAndForget';
import { Telemetry } from '@macro-inc/observability';
import { createMemo, createSignal, onCleanup } from 'solid-js';
import type { IdeaActions, IdeasSource } from '../context/ideas-source';
import {
  type FeedFilter,
  filterCounts,
  type Idea,
  type IdeaStatus,
  ideaResult,
  ideaStatus,
  matchesFilter,
  orderFeed,
} from '../core/idea';

/** One card in the feed. */
export type FeedEntry = {
  idea: Idea;
  status: IdeaStatus;
  /** Turned down here, not yet sent: its card is a one-line Undo row. */
  dismissed: boolean;
  /** Its action is under way. */
  busy: boolean;
  /** Its last action failed. */
  failed: boolean;
};

export type FeedView =
  | { kind: 'loading' }
  | { kind: 'error' }
  | { kind: 'empty' }
  | { kind: 'ideas'; entries: FeedEntry[] };

export type IdeasFeedOptions = {
  /** How long a dismissal waits for Undo before it is sent. */
  undoMs?: number;
};

const UNDO_MS = 8_000;

/**
 * The feed's state: its filter, each card's action, and dismissals. The
 * server has no way to take a dismissal back, so each is held here with an
 * Undo and sent a few seconds after the last one, or when the person leaves.
 */
export function createIdeasFeed(
  source: IdeasSource,
  actions: IdeaActions,
  options: IdeasFeedOptions = {}
) {
  const [filter, setFilter] = createSignal<FeedFilter>('all');
  const [dismissedIds, setDismissedIds] = createSignal<string[]>([]);
  // Sent to the server; hidden until the feed stops listing them.
  const [sentIds, setSentIds] = createSignal<string[]>([]);
  const [busyIds, setBusyIds] = createSignal<string[]>([]);
  const [failedIds, setFailedIds] = createSignal<string[]>([]);

  const ordered = createMemo(() => {
    const ideas = source.ideas();
    if (!ideas) return undefined;

    const sent = sentIds();

    return orderFeed(ideas.filter((idea) => !sent.includes(idea.id)));
  });

  const counts = createMemo(() => {
    const dismissed = dismissedIds();
    return filterCounts(
      (ordered() ?? []).filter((idea) => !dismissed.includes(idea.id))
    );
  });

  const view = createMemo((): FeedView => {
    const ideas = ordered();
    if (!ideas)
      return source.failed() ? { kind: 'error' } : { kind: 'loading' };

    const entries = ideas
      .map((idea) => ({
        idea,
        status: ideaStatus(idea),
        dismissed: dismissedIds().includes(idea.id),
        busy: busyIds().includes(idea.id),
        failed: failedIds().includes(idea.id),
      }))
      .filter((entry) => matchesFilter(entry.status, filter()));
    if (entries.length === 0) return { kind: 'empty' };

    return { kind: 'ideas', entries };
  });

  const without = (id: string) => (ids: string[]) =>
    ids.filter((other) => other !== id);

  /** Run one card's action; a second press while it runs does nothing. */
  const act = async (idea: Idea, name: string, work: () => Promise<void>) => {
    if (busyIds().includes(idea.id)) return;

    setBusyIds((ids) => [...ids, idea.id]);
    setFailedIds(without(idea.id));
    try {
      await Telemetry.span(`ideas.${name}`, async (span) => {
        span.setAttr('idea.id', idea.id);
        span.setAttr('idea.kind', idea.kind);
        await work();
      });
    } catch {
      setFailedIds((ids) => [...ids, idea.id]);
    } finally {
      setBusyIds(without(idea.id));
    }
  };

  /** The card's main action: what taking the idea up means for its kind. */
  const accept = (idea: Idea) =>
    act(idea, 'accept', async () => {
      if (idea.kind === 'routine') {
        // Saving the routine is what makes a routine idea done.
        await actions.turnOnRoutine(idea.routineSuggestionId);
        await source.refresh();
        return;
      }

      if (idea.kind === 'prompt' && idea.runMode === 'composer') {
        await actions.openComposer(idea.prompt);
      }

      if (idea.kind === 'entity') {
        const [about] = idea.about;
        if (idea.draft) actions.openDraft(idea.draft);
        else if (about) actions.openItem(about);
      }

      await source.accept(idea.id);
    });

  const sendDismissal = async (id: string, leaving: boolean) => {
    try {
      await source.dismiss(id, { leaving });
    } catch (error) {
      // Refused: the idea is back in the feed, to dismiss again.
      setSentIds(without(id));
      throw error;
    }
  };

  const sendDismissals = (leaving: boolean) => {
    const ids = dismissedIds();
    if (ids.length === 0) return;

    setDismissedIds([]);
    setSentIds((sent) => [...sent, ...ids]);
    for (const id of ids) {
      // Detached: the page may be going away.
      fireAndForget(sendDismissal(id, leaving), 'ideas');
    }
  };

  const sendAfterUndoWindow = debounce(
    () => sendDismissals(false),
    options.undoMs ?? UNDO_MS
  );

  onCleanup(() => {
    sendAfterUndoWindow.clear();
    sendDismissals(false);
  });

  return {
    filter,
    setFilter,
    counts,
    view,
    accept,
    /** Open what an idea made, else what taking it up opened. */
    open(idea: Idea) {
      const result = ideaResult(idea);
      if (result) return actions.openItem(result);

      if (idea.kind === 'prompt' && idea.runMode === 'composer') {
        return fireAndForget(actions.openComposer(idea.prompt), 'ideas');
      }

      if (idea.kind === 'entity' && idea.draft) {
        return actions.openDraft(idea.draft);
      }

      const [about] = idea.about;
      if (about) actions.openItem(about);
    },
    reviewRoutine(idea: Idea) {
      if (idea.kind === 'routine') {
        actions.reviewRoutine(idea.routineSuggestionId);
      }
    },
    dismiss(idea: Idea) {
      setDismissedIds((ids) => [...without(idea.id)(ids), idea.id]);
      sendAfterUndoWindow();
    },
    undoDismiss(idea: Idea) {
      setDismissedIds(without(idea.id));
    },
    /** Send held dismissals now, as the page goes away. */
    sendDismissals: () => sendDismissals(true),
  };
}

export type IdeasFeed = ReturnType<typeof createIdeasFeed>;
