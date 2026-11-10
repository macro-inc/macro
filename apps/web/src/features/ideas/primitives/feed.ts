import { fireAndForget } from '@core/util/fireAndForget';
import { Telemetry } from '@macro-inc/observability';
import { type Accessor, createMemo, createSignal, onCleanup } from 'solid-js';
import type { IdeaActions, IdeasSource } from '../context/ideas-source';
import {
  type FeedFilter,
  filterCounts,
  type Idea,
  type IdeaStatus,
  ideaResult,
  ideaStatus,
  isNewSince,
  matchesFilter,
  orderFeed,
} from '../core/idea';

/** One card in the feed. */
export type FeedEntry = {
  idea: Idea;
  status: IdeaStatus;
  /** Turned down here, not yet sent: its card is a one-line Undo row. */
  dismissed: boolean;
  /** Arrived since the person last looked. */
  isNew: boolean;
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
  /** When the person last looked at the feed, for the new marks. */
  lastSeenAt?: Accessor<string | undefined>;
  /** The idea to show first, ringed: the one clicked on Home. */
  focusedId?: Accessor<string | undefined>;
};

/**
 * The feed's state: its filter, each card's action, and dismissals, which are
 * held here with an Undo and sent when the person leaves, because the server
 * has no way to take one back.
 */
export function createIdeasFeed(
  source: IdeasSource,
  actions: IdeaActions,
  options: IdeasFeedOptions = {}
) {
  const [filter, setFilter] = createSignal<FeedFilter>('all');
  const [dismissedIds, setDismissedIds] = createSignal<string[]>([]);
  const [busyIds, setBusyIds] = createSignal<string[]>([]);
  const [failedIds, setFailedIds] = createSignal<string[]>([]);

  const ordered = createMemo(() => {
    const ideas = source.ideas();
    if (!ideas) return undefined;

    const feed = orderFeed(ideas);
    const focusedId = options.focusedId?.();
    const focused = feed.find((idea) => idea.id === focusedId);
    if (!focused) return feed;

    return [focused, ...feed.filter((idea) => idea !== focused)];
  });

  const counts = createMemo(() => {
    const dismissed = dismissedIds();
    return filterCounts(
      (ordered() ?? []).filter((idea) => !dismissed.includes(idea.id))
    );
  });

  const view = createMemo((): FeedView => {
    const ideas = ordered();
    if (!ideas) return source.failed() ? { kind: 'error' } : { kind: 'loading' };

    const lastSeenAt = options.lastSeenAt?.();
    const entries = ideas
      .map((idea) => ({
        idea,
        status: ideaStatus(idea),
        dismissed: dismissedIds().includes(idea.id),
        isNew: isNewSince(idea, lastSeenAt),
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

  const sendDismissals = (leaving: boolean) => {
    const ids = dismissedIds();
    if (ids.length === 0) return;

    setDismissedIds([]);
    for (const id of ids) {
      // Detached: the page may be going away, and a failure leaves the idea
      // in the feed to dismiss again.
      fireAndForget(source.dismiss(id, { leaving }), 'ideas');
    }
  };

  onCleanup(() => sendDismissals(false));

  return {
    filter,
    setFilter,
    counts,
    view,
    accept,
    /** Open what a finished idea made, or the item an idea is about. */
    open(idea: Idea) {
      const target = ideaResult(idea) ?? idea.about[0];
      if (target) actions.openItem(target);
    },
    reviewRoutine(idea: Idea) {
      if (idea.kind === 'routine') {
        actions.reviewRoutine(idea.routineSuggestionId);
      }
    },
    dismiss(idea: Idea) {
      setDismissedIds((ids) => [...without(idea.id)(ids), idea.id]);
    },
    undoDismiss(idea: Idea) {
      setDismissedIds(without(idea.id));
    },
    /** Send held dismissals now, as the page goes away. */
    sendDismissals: () => sendDismissals(true),
  };
}

export type IdeasFeed = ReturnType<typeof createIdeasFeed>;
