import { fireAndForget } from '@core/util/fireAndForget';
import { Telemetry } from '@macro-inc/observability';
import { type Accessor, createMemo, createSignal } from 'solid-js';
import type {
  SuggestionActions,
  SuggestionsSource,
} from '../context/suggestions-source';
import {
  type FeedFilter,
  matchesFilter,
  type Suggestion,
  type SuggestionStatus,
  tabCounts,
} from '../core/suggestion';

/** One card in the feed. */
export type FeedEntry = {
  suggestion: Suggestion;
  status: SuggestionStatus;
  /** Turned down during this visit: its card is a one-line Undo row. */
  dismissed: boolean;
  /** Proposed since the person last opened their feed. */
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

/**
 * The feed's state: its filter and each card's action. The server decides
 * every card's status, order and counts; a dismissal is sent at once, and a
 * suggestion dismissed during this visit stays as a row whose Undo asks the
 * server to restore it.
 */
export function createSuggestionsFeed(
  source: SuggestionsSource,
  actions: SuggestionActions,
  options: {
    /**
     * Who is signed in. What a card holds belongs to that account: if it
     * changes while a request is out, the answer opens nothing.
     */
    viewer?: Accessor<string | undefined>;
  } = {}
) {
  const [filter, setFilter] = createSignal<FeedFilter>('all');
  // Dismissed during this visit, as they were: the feed no longer lists them.
  const [dismissed, setDismissed] = createSignal<Suggestion[]>([]);
  const [busyIds, setBusyIds] = createSignal<string[]>([]);
  const [failedIds, setFailedIds] = createSignal<string[]>([]);
  const [changedIds, setChangedIds] = createSignal<string[]>([]);

  const counts = createMemo(() =>
    tabCounts(
      source.feed()?.counts ?? { open: 0, running: 0, failed: 0, done: 0 }
    )
  );

  const view = createMemo((): FeedView => {
    const feed = source.feed();
    if (!feed) return source.failed() ? { kind: 'error' } : { kind: 'loading' };

    const gone = dismissed();
    const entry = (suggestion: Suggestion, isDismissed: boolean) => ({
      suggestion,
      status: suggestion.status,
      dismissed: isDismissed,
      isNew: suggestion.isNew,
      busy: busyIds().includes(suggestion.id),
      failed: failedIds().includes(suggestion.id),
      changed: changedIds().includes(suggestion.id),
    });
    const entries = [
      ...feed.suggestions
        // Between a dismissal and the next read the feed may still list it.
        .filter(
          (suggestion) => !gone.some((other) => other.id === suggestion.id)
        )
        .map((suggestion) => entry(suggestion, false)),
      ...gone.map((suggestion) => entry(suggestion, true)),
    ].filter((shown) => matchesFilter(shown.status, filter()));
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

      // Accepted first: a suggestion rewritten under the card opens nothing,
      // and the card shows it as it is now.
      const viewer = options.viewer?.();
      const answer = await source.accept(suggestion);
      // The card's prompt and items are the earlier account's.
      if (options.viewer?.() !== viewer) return;
      if (answer === 'changed') {
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

  return {
    filter,
    setFilter,
    counts,
    view,
    accept,
    /**
     * Open what a finished suggestion left, a running one's session, else
     * what taking it up opened.
     */
    open(suggestion: Suggestion) {
      if (suggestion.result) return actions.openItem(suggestion.result);

      if (suggestion.kind === 'prompt' && suggestion.runMode === 'background') {
        // Its run's session shows the work under way.
        if (suggestion.run) {
          actions.openItem({
            entityType: 'agent_session',
            entityId: suggestion.run.sessionId,
          });
        }
        return;
      }

      if (suggestion.kind === 'prompt') {
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
    /** A routine that can't be opened for review marks the card failed. */
    reviewRoutine: (suggestion: Suggestion) =>
      act(suggestion, 'review', async () => {
        if (suggestion.kind === 'routine') {
          actions.reviewRoutine(suggestion.routineSuggestionId);
        }
      }),
    /** Sent at once; a refusal leaves the card, marked failed. */
    dismiss: (suggestion: Suggestion) =>
      act(suggestion, 'dismiss', async () => {
        await source.dismiss(suggestion.id);
        setDismissed((list) => [
          ...list.filter((other) => other.id !== suggestion.id),
          suggestion,
        ]);
      }),
    /** Ask the server to bring it back; a refusal leaves the row, marked failed. */
    undoDismiss: (suggestion: Suggestion) =>
      act(suggestion, 'restore', async () => {
        await source.restore(suggestion.id);
        setDismissed((list) =>
          list.filter((other) => other.id !== suggestion.id)
        );
      }),
  };
}

export type SuggestionsFeed = ReturnType<typeof createSuggestionsFeed>;
