import { debounce } from '@core/util/debounce';
import { fireAndForget } from '@core/util/fireAndForget';
import { Telemetry } from '@macro-inc/observability';
import { type Accessor, createMemo, createSignal, onCleanup } from 'solid-js';
import type {
  SuggestionActions,
  SuggestionsSource,
} from '../context/suggestions-source';
import {
  type FeedFilter,
  filterCounts,
  isNewSince,
  matchesFilter,
  orderFeed,
  type Suggestion,
  type SuggestionStatus,
  suggestionResult,
  suggestionStatus,
} from '../core/suggestion';

/** One card in the feed. */
export type FeedEntry = {
  suggestion: Suggestion;
  status: SuggestionStatus;
  /** Turned down here, not yet sent: its card is a one-line Undo row. */
  dismissed: boolean;
  /** Arrived since the person last looked. */
  isNew: boolean;
  /** Its action is under way. */
  busy: boolean;
  /** Its last action failed. */
  failed: boolean;
  /** It was rewritten under the card: the action took nothing up, and the card now shows the new text. */
  changed: boolean;
};

export type FeedView =
  | { kind: 'loading' }
  | { kind: 'error' }
  | { kind: 'empty' }
  | { kind: 'suggestions'; entries: FeedEntry[] };

export type SuggestionsFeedOptions = {
  /** When the person last looked at the feed, for the new marks. */
  lastSeenAt?: Accessor<string | undefined>;
  /** How long a dismissal waits for Undo before it is sent. */
  undoMs?: number;
};

const UNDO_MS = 8_000;

/**
 * The feed's state: its filter, each card's action, and dismissals. The
 * server has no way to take a dismissal back, so each is held here with an
 * Undo and sent a few seconds after the last one, or when the person leaves.
 */
export function createSuggestionsFeed(
  source: SuggestionsSource,
  actions: SuggestionActions,
  options: SuggestionsFeedOptions = {}
) {
  const [filter, setFilter] = createSignal<FeedFilter>('all');
  const [dismissedIds, setDismissedIds] = createSignal<string[]>([]);
  // Sent to the server; hidden until the feed stops listing them.
  const [sentIds, setSentIds] = createSignal<string[]>([]);
  const [busyIds, setBusyIds] = createSignal<string[]>([]);
  const [failedIds, setFailedIds] = createSignal<string[]>([]);
  const [changedIds, setChangedIds] = createSignal<string[]>([]);

  const ordered = createMemo(() => {
    const suggestions = source.suggestions();
    if (!suggestions) return undefined;

    const sent = sentIds();

    return orderFeed(
      suggestions.filter((suggestion) => !sent.includes(suggestion.id))
    );
  });

  const counts = createMemo(() => {
    const dismissed = dismissedIds();
    return filterCounts(
      (ordered() ?? []).filter(
        (suggestion) => !dismissed.includes(suggestion.id)
      )
    );
  });

  const view = createMemo((): FeedView => {
    const suggestions = ordered();
    if (!suggestions)
      return source.failed() ? { kind: 'error' } : { kind: 'loading' };

    const entries = suggestions
      .map((suggestion) => ({
        suggestion,
        status: suggestionStatus(suggestion),
        dismissed: dismissedIds().includes(suggestion.id),
        isNew: isNewSince(suggestion, options.lastSeenAt?.()),
        busy: busyIds().includes(suggestion.id),
        failed: failedIds().includes(suggestion.id),
        changed: changedIds().includes(suggestion.id),
      }))
      .filter((entry) => matchesFilter(entry.status, filter()));
    if (entries.length === 0) return { kind: 'empty' };

    return { kind: 'suggestions', entries };
  });

  const without = (id: string) => (ids: string[]) =>
    ids.filter((other) => other !== id);

  /** Run one card's action; a second press while it runs does nothing. */
  const act = async (
    suggestion: Suggestion,
    name: string,
    work: () => Promise<void>
  ) => {
    if (busyIds().includes(suggestion.id)) return;

    setBusyIds((ids) => [...ids, suggestion.id]);
    setFailedIds(without(suggestion.id));
    setChangedIds(without(suggestion.id));
    try {
      await Telemetry.span(`suggestions.${name}`, async (span) => {
        span.setAttr('suggestion.id', suggestion.id);
        span.setAttr('suggestion.kind', suggestion.kind);
        await work();
      });
    } catch {
      setFailedIds((ids) => [...ids, suggestion.id]);
    } finally {
      setBusyIds(without(suggestion.id));
    }
  };

  /** The card's main action: what taking the suggestion up means for its kind. */
  const accept = (suggestion: Suggestion) =>
    act(suggestion, 'accept', async () => {
      if (suggestion.kind === 'routine') {
        // Saving the routine is what makes a routine suggestion done.
        await actions.turnOnRoutine(suggestion.routineSuggestionId);
        await source.refresh();
        return;
      }

      // Accepted first: an suggestion rewritten under the card opens nothing, and
      // the card shows it as it is now.
      if ((await source.accept(suggestion)) === 'changed') {
        setChangedIds((ids) => [...ids, suggestion.id]);
        return;
      }

      if (suggestion.kind === 'prompt' && suggestion.runMode === 'composer') {
        await actions.openComposer(suggestion.prompt);
      }

      if (suggestion.kind === 'entity') {
        const [about] = suggestion.about;
        if (suggestion.draft) actions.openDraft(suggestion.draft);
        else if (about) actions.openItem(about);
      }
    });

  const sendDismissal = async (id: string, leaving: boolean) => {
    try {
      await source.dismiss(id, { leaving });
    } catch (error) {
      // Refused: the suggestion is back in the feed, and its card says the
      // dismissal didn't go through.
      setSentIds(without(id));
      setFailedIds((ids) => [...without(id)(ids), id]);
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
      fireAndForget(sendDismissal(id, leaving), 'suggestions');
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
    /** Open what an suggestion made, else what taking it up opened. */
    open(suggestion: Suggestion) {
      const result = suggestionResult(suggestion);
      if (result) return actions.openItem(result);

      if (suggestion.kind === 'prompt' && suggestion.runMode === 'composer') {
        return fireAndForget(
          actions.openComposer(suggestion.prompt),
          'suggestions'
        );
      }

      if (suggestion.kind === 'entity' && suggestion.draft) {
        return actions.openDraft(suggestion.draft);
      }

      const [about] = suggestion.about;
      if (about) actions.openItem(about);
    },
    /** Put a prompt suggestion's prompt in the composer to edit, without taking it up. */
    openInChat(suggestion: Suggestion) {
      if (suggestion.kind !== 'prompt') return;

      fireAndForget(actions.openComposer(suggestion.prompt), 'suggestions');
    },
    reviewRoutine(suggestion: Suggestion) {
      if (suggestion.kind === 'routine') {
        actions.reviewRoutine(suggestion.routineSuggestionId);
      }
    },
    dismiss(suggestion: Suggestion) {
      setDismissedIds((ids) => [...without(suggestion.id)(ids), suggestion.id]);
      sendAfterUndoWindow();
    },
    undoDismiss(suggestion: Suggestion) {
      setDismissedIds(without(suggestion.id));
    },
    /** Send held dismissals now, as the page goes away. */
    sendDismissals: () => sendDismissals(true),
  };
}

export type SuggestionsFeed = ReturnType<typeof createSuggestionsFeed>;
