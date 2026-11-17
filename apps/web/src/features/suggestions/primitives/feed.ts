import { Telemetry } from '@macro-inc/observability';
import { type Accessor, createMemo, createSignal } from 'solid-js';
import type {
  SuggestionActions,
  SuggestionsSource,
} from '../context/suggestions-source';
import {
  doneWhenTakenUp,
  type Suggestion,
  type SuggestionStatus,
} from '../core/suggestion';

/** One row in the feed. */
export type FeedEntry = {
  suggestion: Suggestion;
  status: SuggestionStatus;
  /** Turned down during this visit: its row stays, with Undo. */
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
 * The feed's state and each row's action. The server decides every
 * suggestion's status and order; a dismissal is sent at once, and a
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
  // Dismissed during this visit, as they were: the feed no longer lists them.
  const [dismissed, setDismissed] = createSignal<Suggestion[]>([]);
  const [busyIds, setBusyIds] = createSignal<string[]>([]);
  const [failedIds, setFailedIds] = createSignal<string[]>([]);
  const [changedIds, setChangedIds] = createSignal<string[]>([]);

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
    ];
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
    view,
    accept,
    /**
     * Take a suggestion up without opening anything: the person has dealt
     * with it. Only for a suggestion that taking up finishes
     * (`doneWhenTakenUp`): a background prompt would start its run, a routine
     * suggestion be saved, and a reply stay open until the person replies.
     */
    markDone: (suggestion: Suggestion) =>
      act(suggestion, 'done', async () => {
        if (!doneWhenTakenUp(suggestion)) return;

        const answer = await source.accept(suggestion);
        if (answer === 'changed') {
          setChangedIds((ids) => [...ids, suggestion.id]);
        }
      }),
    /**
     * Look at work Macro would do without taking it up: a routine's draft, a
     * run's session while it is under way, else its prompt in the composer,
     * to read or edit. A routine that can't be opened marks the row failed.
     */
    look: (suggestion: Suggestion) =>
      act(suggestion, 'look', async () => {
        if (suggestion.kind === 'routine') {
          actions.reviewRoutine(suggestion.routineSuggestionId);
          return;
        }
        if (suggestion.kind !== 'prompt') return;

        if (suggestion.status === 'running') {
          if (suggestion.runMode === 'background' && suggestion.run) {
            actions.openItem({
              entityType: 'agent_session',
              entityId: suggestion.run.sessionId,
            });
          }
          return;
        }

        await actions.openComposer(suggestion.prompt);
      }),
    /** Open what a finished suggestion left, else what taking it up opened. */
    open: (suggestion: Suggestion) =>
      act(suggestion, 'open', async () => {
        if (suggestion.result) return actions.openItem(suggestion.result);
        // A finished run that left nothing has nothing to open.
        if (suggestion.kind === 'routine') return;
        if (suggestion.kind === 'prompt') {
          if (suggestion.runMode === 'composer') {
            await actions.openComposer(suggestion.prompt);
          }
          return;
        }

        if (suggestion.draft) return actions.openDraft(suggestion.draft);

        const [about] = suggestion.about;
        if (about) actions.openItem(about);
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
