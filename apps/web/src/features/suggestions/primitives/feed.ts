import { Telemetry } from '@macro-inc/observability';
import { ResultAsync } from 'neverthrow';
import { type Accessor, createMemo, createSignal } from 'solid-js';
import type {
  SuggestionActions,
  SuggestionsSource,
} from '../context/suggestions-source';
import { holdInPlace } from '../core/hold';
import {
  type FeedEntry,
  type ForYouList,
  inList,
  type ListCounts,
  type RowState,
  settledState,
} from '../core/lists';
import { doneWhenTakenUp, type Suggestion } from '../core/suggestion';

export type FeedView =
  | { kind: 'loading' }
  | { kind: 'error' }
  | { kind: 'empty' }
  | { kind: 'rows'; entries: FeedEntry[] };

const isLive = (suggestion: Suggestion) => suggestion.status !== 'done';

/**
 * The page's lists and each row's actions. The server decides every
 * suggestion's status and order. What settles or is dismissed during the
 * visit stays where it was, in its settled state, until the person leaves:
 * a dismissal and marking done are sent at once, and Undo asks the server to
 * restore the suggestion.
 */
export function createSuggestionsFeed(
  source: SuggestionsSource,
  actions: SuggestionActions,
  options: {
    /**
     * Who is signed in. What a row holds belongs to that account: if it
     * changes while a request is out, the answer opens nothing.
     */
    viewer?: Accessor<string | undefined>;
  } = {}
) {
  // Dismissed during this visit, as they were: the feed no longer lists them.
  const [dismissed, setDismissed] = createSignal<Suggestion[]>([]);
  // Marked done (or taken up, which finished them) here, for Undo.
  const [completedIds, setCompletedIds] = createSignal<string[]>([]);
  const [busyIds, setBusyIds] = createSignal<string[]>([]);
  const [failedIds, setFailedIds] = createSignal<string[]>([]);
  const [changedIds, setChangedIds] = createSignal<string[]>([]);

  // Every suggestion seen waiting or running during this visit: one of them
  // the feed later lists as done settled here, and stays in place.
  const seenLive = createMemo<string[]>((seen) => {
    const added = (source.feed()?.suggestions ?? [])
      .filter(
        (suggestion) => isLive(suggestion) && !seen.includes(suggestion.id)
      )
      .map((suggestion) => suggestion.id);

    return added.length > 0 ? [...seen, ...added] : seen;
  }, []);

  const isDismissed = (id: string) =>
    dismissed().some((suggestion) => suggestion.id === id);

  // Every row shown during the visit, in the server's order, with the ones it
  // no longer lists kept where they were: a row the feed drops before the
  // page knows it was dismissed (the refresh after a dismissal lands first)
  // still has its place when it comes back as dismissed.
  const places = createMemo<string[]>((previous) => {
    const feed = source.feed();
    if (!feed) return previous;

    const live = feed.suggestions
      .filter((suggestion) => isLive(suggestion) && !isDismissed(suggestion.id))
      .map((suggestion) => suggestion.id);
    const gone = previous.filter((id) => !live.includes(id));
    const added = dismissed()
      .map((suggestion) => suggestion.id)
      .filter((id) => !gone.includes(id));

    return holdInPlace(live, [...gone, ...added], previous);
  }, []);

  // The rows of every list but Done: what waits or runs, and what settled or
  // was dismissed during the visit, in `places`.
  const order = () => {
    const shown = (id: string) => {
      if (isDismissed(id)) return true;

      const suggestion = source
        .feed()
        ?.suggestions.find((other) => other.id === id);
      if (!suggestion) return false;

      return isLive(suggestion) || seenLive().includes(id);
    };

    return places().filter(shown);
  };

  const entry = (suggestion: Suggestion, state: RowState): FeedEntry => ({
    suggestion,
    state,
    isNew: suggestion.isNew,
    busy: busyIds().includes(suggestion.id),
    failed: failedIds().includes(suggestion.id),
    changed: changedIds().includes(suggestion.id),
    canUndo: state === 'markedDone' && completedIds().includes(suggestion.id),
  });

  // Each row of every list but Done, by id, in `order`.
  const rows = createMemo((): FeedEntry[] => {
    const feed = source.feed();
    if (!feed) return [];

    return order().flatMap((id) => {
      const gone = dismissed().find((suggestion) => suggestion.id === id);
      if (gone) return [entry(gone, 'dismissed')];

      const suggestion = feed.suggestions.find((other) => other.id === id);
      if (!suggestion) return [];
      if (isLive(suggestion)) return [entry(suggestion, suggestion.status)];

      return [entry(suggestion, settledState(suggestion))];
    });
  });

  const done = () =>
    (source.feed()?.suggestions ?? [])
      .filter(
        (suggestion) => !isLive(suggestion) && !isDismissed(suggestion.id)
      )
      .map((suggestion) => entry(suggestion, 'done'));

  /** One list's rows, or why there are none. */
  const view = (list: ForYouList): FeedView => {
    if (!source.feed()) {
      return source.failed() ? { kind: 'error' } : { kind: 'loading' };
    }

    const entries =
      list === 'done'
        ? done()
        : rows().filter((row) => inList(list, row.suggestion));
    return entries.length > 0 ? { kind: 'rows', entries } : { kind: 'empty' };
  };

  /** How many rows wait in each list; undefined until the feed is read. */
  const counts = (): ListCounts | undefined => {
    const feed = source.feed();
    if (!feed) return undefined;

    const waiting = feed.suggestions.filter(
      (suggestion) => isLive(suggestion) && !isDismissed(suggestion.id)
    );
    const count = (list: ForYouList) =>
      waiting.filter((suggestion) => inList(list, suggestion)).length;
    return {
      today: count('today'),
      toDo: count('toDo'),
      suggestions: count('suggestions'),
      done: done().length,
    };
  };

  const without = (id: string) => (ids: string[]) =>
    ids.filter((other) => other !== id);

  /**
   * Run one row's action; a second press while it runs does nothing.
   * Resolves whether it succeeded.
   */
  const act = async (
    suggestion: Suggestion,
    name: string,
    work: () => Promise<void>
  ): Promise<boolean> => {
    if (busyIds().includes(suggestion.id)) return false;

    setBusyIds((ids) => [...ids, suggestion.id]);
    setFailedIds(without(suggestion.id));
    setChangedIds(without(suggestion.id));
    try {
      await Telemetry.span(`suggestions.${name}`, async (span) => {
        span.setAttr('suggestion.id', suggestion.id);
        span.setAttr('suggestion.kind', suggestion.kind);
        await work();
      });
      return true;
    } catch {
      setFailedIds((ids) => [...ids, suggestion.id]);
      return false;
    } finally {
      setBusyIds(without(suggestion.id));
    }
  };

  /**
   * A dismissal that failed may still have reached the server (only its
   * answer was lost), or the suggestion may have settled first (a run that
   * finished can't be dismissed). The feed, read again, says which.
   */
  const settleFailedDismissal = async (
    suggestion: Suggestion,
    error: unknown
  ) => {
    await source.refresh();
    const feed = source.feed();
    const now = feed?.suggestions.find((other) => other.id === suggestion.id);
    // No longer listed: the server has the dismissal. The row stays, with Undo.
    if (feed && !now) return;

    setDismissed((list) => list.filter((other) => other.id !== suggestion.id));
    // Still waiting or running: refused, so the row opens again, failed.
    // Settled first: the row shows what it left.
    if (!now || isLive(now)) throw error;
  };

  const completed = (suggestion: Suggestion) =>
    setCompletedIds((ids) => [...without(suggestion.id)(ids), suggestion.id]);

  /** Taken up, answered `changed`: the row shows the new text and a note. */
  const rewritten = (suggestion: Suggestion) =>
    setChangedIds((ids) => [...ids, suggestion.id]);

  /**
   * The row's main action: what taking the suggestion up means for its kind.
   * Resolves whether it was taken up.
   */
  const accept = async (suggestion: Suggestion): Promise<boolean> => {
    let taken = true;
    const succeeded = await act(suggestion, 'accept', async () => {
      if (suggestion.kind === 'routine') {
        // Saving the routine, switched on, is what makes a routine
        // suggestion done.
        await actions.turnOnRoutine(suggestion.routineSuggestionId);
        await source.refresh();
        return;
      }

      // Accepted first: a suggestion rewritten under the row opens nothing,
      // and the row shows it as it is now.
      const viewer = options.viewer?.();
      const answer = await source.accept(suggestion);
      // The row's prompt and items are the earlier account's.
      if (options.viewer?.() !== viewer) {
        taken = false;
        return;
      }
      if (answer === 'changed') {
        taken = false;
        rewritten(suggestion);
        return;
      }
      if (doneWhenTakenUp(suggestion)) completed(suggestion);

      if (suggestion.kind === 'prompt' && suggestion.runMode === 'composer') {
        await actions.openComposer(suggestion.prompt);
      }

      if (suggestion.kind === 'entity') {
        const [about] = suggestion.about;
        if (suggestion.draft) actions.openDraft(suggestion.draft);
        else if (about) actions.openItem(about);
      }
    });

    return succeeded && taken;
  };

  return {
    view,
    counts,
    accept,
    /**
     * Take a suggestion up without opening anything: the person has dealt
     * with it. Only for a suggestion that taking up finishes
     * (`doneWhenTakenUp`): a background prompt would start its run, a routine
     * suggestion be saved, and a reply stay open until the person replies.
     * Resolves whether it is done.
     */
    markDone: async (suggestion: Suggestion): Promise<boolean> => {
      if (!doneWhenTakenUp(suggestion)) return false;

      let taken = true;
      const succeeded = await act(suggestion, 'done', async () => {
        const answer = await source.accept(suggestion);
        if (answer === 'changed') {
          taken = false;
          rewritten(suggestion);
          return;
        }
        completed(suggestion);
      });

      return succeeded && taken;
    },
    /** Open again what the person marked done here; a refusal marks the row failed. */
    undoDone: (suggestion: Suggestion) =>
      act(suggestion, 'undo_done', async () => {
        await source.restore(suggestion);
        setCompletedIds(without(suggestion.id));
      }),
    /** Stop a run under way and keep the suggestion: it is open again once the run stops. */
    stop: (suggestion: Suggestion) =>
      act(suggestion, 'stop', () => source.stop(suggestion.id)),
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
        // A finished run or routine that left nothing has nothing to open.
        if (suggestion.kind === 'routine') return;
        if (suggestion.kind === 'prompt') {
          if (suggestion.runMode === 'composer') {
            await actions.openComposer(suggestion.prompt);
          } else if (suggestion.run) {
            actions.openItem({
              entityType: 'agent_session',
              entityId: suggestion.run.sessionId,
            });
          }
          return;
        }

        if (suggestion.draft) return actions.openDraft(suggestion.draft);

        const [about] = suggestion.about;
        if (about) actions.openItem(about);
      }),
    /**
     * Sent at once, and the row shows dismissed from the press: the feed
     * drops the suggestion as soon as the server has it, before the call
     * answers. A failure is settled against the feed, read again
     * (`settleFailedDismissal`).
     */
    dismiss: (suggestion: Suggestion) =>
      act(suggestion, 'dismiss', async () => {
        const holdOthers = (list: Suggestion[]) =>
          list.filter((other) => other.id !== suggestion.id);
        setDismissed((list) => [...holdOthers(list), suggestion]);
        const sent = await ResultAsync.fromPromise(
          source.dismiss(suggestion.id),
          (error) => error
        );
        if (sent.isErr()) await settleFailedDismissal(suggestion, sent.error);
      }),
    /** Ask the server to bring it back; a refusal leaves the row, marked failed. */
    undoDismiss: (suggestion: Suggestion) =>
      act(suggestion, 'restore', async () => {
        await source.restore(suggestion);
        setDismissed((list) =>
          list.filter((other) => other.id !== suggestion.id)
        );
      }),
  };
}

export type SuggestionsFeed = ReturnType<typeof createSuggestionsFeed>;
