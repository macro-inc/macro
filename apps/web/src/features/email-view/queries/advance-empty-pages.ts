import { fireAndForget } from '@core/util/fireAndForget';
import {
  type Accessor,
  batch,
  createEffect,
  createSignal,
  on,
  onCleanup,
  untrack,
} from 'solid-js';

/** Most pages one load reads (a search's first page, or one Load More) while
 * they add no row. Each search page can itself read several index pages. */
export const MAX_PAGES_PER_LOAD = 5;

/** The Load More label once a load has read its pages without adding a row. */
export const EMPTY_PAGES_LOAD_MORE_LABEL =
  'No matches in the next pages. Search further';

type Load = {
  scope: string;
  /** Rows shown when the load started; it ends once there are more. */
  rows: number;
  pages: number;
  ended: boolean;
};

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
  rows: Accessor<number>;
  hasNextPage: Accessor<boolean>;
  loadMore: () => Promise<unknown>;
}) {
  const [running, setRunning] = createSignal(false);
  const [failure, setFailure] = createSignal<{ scope: string; error: Error }>();
  const [load, setLoad] = createSignal<Load>();
  let disposed = false;
  onCleanup(() => {
    disposed = true;
  });
  const error = () =>
    failure()?.scope === options.scope() ? failure()?.error : undefined;
  // A search's first page starts its first load.
  const currentLoad = (): Load => {
    const scope = options.scope();
    const started = load();
    return started?.scope === scope
      ? started
      : { scope, rows: 0, pages: 1, ended: false };
  };

  // One request at a time: a Load More during a read-on waits for its page.
  // A read-on's failure is latched before it stops running, so the effect
  // never retries it unasked; Load More's own failure goes to its caller.
  let inFlight: Promise<void> | undefined;
  async function fetchPage(latchFailure?: string) {
    setRunning(true);
    try {
      await options.loadMore();
    } catch (cause) {
      if (latchFailure === undefined) throw cause;
      if (!disposed)
        setFailure({
          scope: latchFailure,
          error:
            cause instanceof Error
              ? cause
              : new Error('Email could not be loaded'),
        });
    } finally {
      inFlight = undefined;
      if (!disposed) setRunning(false);
    }
  }
  const fetchOnce = (latchFailure?: string) =>
    (inFlight ??= fetchPage(latchFailure));

  async function advance(current: Load) {
    setLoad({ ...current, pages: current.pages + 1 });
    await fetchOnce(current.scope);
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
        if (failure() && failure()?.scope !== current.scope)
          setFailure(undefined);
        if (!enabled || !ready || busy || failed) return;
        // A list emptied after its load ended (its last row archived) reads
        // on as a first page does.
        if (current.ended && rows === 0 && hasNextPage) {
          setLoad({ scope: current.scope, rows: 0, pages: 1, ended: false });
          return;
        }
        if (current.ended) return;
        if (rows > current.rows || !hasNextPage) {
          setLoad({ ...current, ended: true });
          return;
        }
        if (current.pages < MAX_PAGES_PER_LOAD)
          untrack(() => fireAndForget(advance(current), 'email-view'));
      }
    )
  );

  return {
    isFetching: running,
    error,
    resetError: () => setFailure(undefined),
    /** Load More: fetches the next page, then reads on while pages add no row. */
    loadMore: () => {
      batch(() => {
        setFailure(undefined);
        setLoad({
          scope: options.scope(),
          rows: options.rows(),
          pages: 1,
          ended: false,
        });
        setRunning(true);
      });
      return fetchOnce();
    },
    /** The load read its pages without adding a row, and more remain. */
    stoppedShort: () => {
      const current = currentLoad();
      return (
        options.enabled() &&
        !running() &&
        !current.ended &&
        current.pages >= MAX_PAGES_PER_LOAD &&
        options.rows() <= current.rows &&
        options.hasNextPage()
      );
    },
  };
}
