import { fireAndForget } from '@core/util/fireAndForget';
import {
  type Accessor,
  batch,
  createEffect,
  createMemo,
  createSignal,
  on,
  onCleanup,
  untrack,
} from 'solid-js';
import { match } from 'ts-pattern';

/** Most pages one load reads (a search's first page, or one Load More) while
 * they add no row. Each search page can itself read several index pages. */
export const MAX_PAGES_PER_LOAD = 5;

/** The Load More label once a load has read its pages without adding a row. */
export const EMPTY_PAGES_LOAD_MORE_LABEL =
  'No matches in the next pages. Search further';

type Load = {
  visit: number;
  /** Rows shown when the load started; it ends once another one shows. */
  rows: readonly string[];
  pages: number;
  ended: boolean;
};

const addsRow = (rows: readonly string[], start: readonly string[]) => {
  const shown = new Set(start);
  return rows.some((id) => !shown.has(id));
};

/** What a settled load does next. A list emptied after its load ended (its
 * last row archived) restarts, reading on as a first page does. */
function nextStep(
  current: Load,
  rows: readonly string[],
  hasNextPage: boolean
): 'restart' | 'end' | 'advance' | 'stop' {
  if (current.ended)
    return rows.length === 0 && hasNextPage ? 'restart' : 'stop';
  if (addsRow(rows, current.rows) || !hasNextPage) return 'end';
  return current.pages < MAX_PAGES_PER_LOAD ? 'advance' : 'stop';
}

/** A page of candidates can add no row: alias or saved-view membership is
 * resolved by GraphQL after it arrives, a client-side facet drops hits, or
 * the service checked fewer hits than a page holds. Read on through such
 * pages after a search's first page and after each Load More, waiting for
 * membership and stopping on a new row, exhaustion, an error, a change of
 * view, or `MAX_PAGES_PER_LOAD`. */
export function advanceEmptyPages(options: {
  scope: Accessor<string>;
  enabled: Accessor<boolean>;
  ready: Accessor<boolean>;
  /** Ids of the rows shown. */
  rows: Accessor<readonly string[]>;
  hasNextPage: Accessor<boolean>;
  loadMore: () => Promise<unknown>;
}) {
  // Each visit to a scope gets its own page budget and failures, so a request
  // from an earlier visit never settles the current one.
  let visits = 0;
  const visit = createMemo(on(options.scope, () => ++visits));
  const [running, setRunning] = createSignal(false);
  const [failure, setFailure] = createSignal<{ visit: number; error: Error }>();
  const [load, setLoad] = createSignal<Load>();
  let disposed = false;
  onCleanup(() => {
    disposed = true;
  });
  const error = () =>
    failure()?.visit === visit() ? failure()?.error : undefined;
  // A search's first page starts its first load.
  const currentLoad = (): Load => {
    const current = visit();
    const started = load();
    return started?.visit === current
      ? started
      : { visit: current, rows: [], pages: 1, ended: false };
  };

  // One request at a time: a Load More during a read-on waits for its page.
  // A read-on's failure is latched before it stops running, so the effect
  // never retries it unasked; Load More's own failure goes to its caller.
  // A request clears only its own slot: a loader that throws synchronously
  // settles before `fetchOnce` has stored its promise.
  let inFlight: { request: Promise<void> } | undefined;
  async function fetchPage(slot: object, latchFailure?: number) {
    setRunning(true);
    try {
      await options.loadMore();
    } catch (cause) {
      if (latchFailure === undefined) throw cause;
      if (!disposed)
        setFailure({
          visit: latchFailure,
          error:
            cause instanceof Error
              ? cause
              : new Error('Email could not be loaded'),
        });
    } finally {
      if (inFlight === slot) inFlight = undefined;
      if (!disposed) setRunning(false);
    }
  }
  const fetchOnce = (latchFailure?: number) => {
    if (inFlight) return inFlight.request;
    const slot = { request: Promise.resolve() };
    inFlight = slot;
    slot.request = fetchPage(slot, latchFailure);
    return slot.request;
  };

  async function advance(current: Load) {
    setLoad({ ...current, pages: current.pages + 1 });
    await fetchOnce(current.visit);
  }

  createEffect(
    on(
      [
        currentLoad,
        options.enabled,
        options.ready,
        options.rows,
        options.hasNextPage,
        running,
        error,
      ],
      ([current, enabled, ready, rows, hasNextPage, busy, failed]) => {
        if (failure() && failure()?.visit !== current.visit)
          setFailure(undefined);
        if (!enabled || !ready || busy || failed) return;
        match(nextStep(current, rows, hasNextPage))
          .with('restart', () =>
            setLoad({ visit: current.visit, rows: [], pages: 1, ended: false })
          )
          .with('end', () => setLoad({ ...current, ended: true }))
          .with('advance', () =>
            untrack(() => fireAndForget(advance(current), 'email-view'))
          )
          .with('stop', () => undefined)
          .exhaustive(() => undefined);
      }
    )
  );

  const settledStep = () =>
    options.enabled() && options.ready() && !running() && !error()
      ? nextStep(currentLoad(), options.rows(), options.hasNextPage())
      : undefined;

  return {
    /** Fetching, or about to: the effect has not started the next page yet. */
    isFetching: () => {
      if (running()) return true;
      const step = settledStep();
      return step === 'restart' || step === 'advance';
    },
    error,
    resetError: () => setFailure(undefined),
    /** Load More: fetches the next page, then reads on while pages add no row. */
    loadMore: () => {
      batch(() => {
        setFailure(undefined);
        setLoad({
          visit: visit(),
          rows: [...options.rows()],
          pages: 1,
          ended: false,
        });
        setRunning(true);
      });
      return fetchOnce();
    },
    /** The load read its pages, each settling without an error, without
     * adding a row, and more remain. */
    stoppedShort: () =>
      !currentLoad().ended && settledStep() === 'stop' && options.hasNextPage(),
  };
}
