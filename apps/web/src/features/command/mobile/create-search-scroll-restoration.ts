import { useSplitPanelOrThrow } from '@components/app/split-layout/layoutUtils';
import { fireAndForget } from '@core/util/fireAndForget';
import { Telemetry } from '@macro-inc/observability';
import {
  type Accessor,
  createEffect,
  createSignal,
  on,
  onCleanup,
  untrack,
} from 'solid-js';
import type { EntitySearchCategory } from '../queries/entity-search';

type SearchAnchor = { id?: string; offset: number; within: number };
type SearchScrollState = SearchAnchor & {
  accountId: string;
  query: string;
  category: EntitySearchCategory;
};
const MAX_RESTORE_PAGES = 3;

/** Restore from current source rows, without keeping a second result cache in history. */
export function createSearchScrollRestoration<T>(options: {
  key: string;
  accountId: Accessor<string>;
  query: Accessor<string>;
  category: Accessor<EntitySearchCategory>;
  items: Accessor<readonly T[]>;
  ready: Accessor<boolean>;
  busy: Accessor<boolean>;
  failed: Accessor<boolean>;
  hasMore: Accessor<boolean>;
  loadMore: () => Promise<unknown>;
  read: () => SearchAnchor;
  apply: (anchor: SearchAnchor) => boolean;
}) {
  const { handle } = useSplitPanelOrThrow();
  const saved = untrack(() => handle.currentEntryState()?.[options.key]) as
    | SearchScrollState
    | undefined;
  const matches = (state: SearchScrollState) =>
    state.accountId === options.accountId() &&
    state.query === options.query() &&
    state.category === options.category();
  const [pending, setPending] = createSignal(
    saved && untrack(() => matches(saved)) ? saved : undefined
  );
  const [paginationAllowed, setPaginationAllowed] = createSignal(!pending());
  const [revision, setRevision] = createSignal(0);
  const span = pending() ? Telemetry.span('mobile.search.restore') : undefined;
  span?.setAttr('restore.kind', options.key);
  // Person keys and account IDs can contain an email address.
  span?.setAttr('restore.has_anchor', !!saved?.id);
  let pages = 0;
  let disposed = false;
  let loading = false;
  let queued = false;
  let lastPage: readonly T[] | undefined;
  const finish = (outcome: string) => {
    if (!pending()) return;
    lastPage = undefined;
    setPending(undefined);
    if (outcome === 'fetch_failed' || outcome === 'source_failed')
      span?.error('Search restoration source failed');
    span?.setAttr('restore.outcome', outcome);
    span?.setAttr('restore.pages', pages);
    span?.end();
  };
  const load = async () => {
    loading = true;
    try {
      await options.loadMore();
    } catch {
      finish('fetch_failed');
    } finally {
      loading = false;
      if (!disposed) setRevision((value) => value + 1);
    }
  };
  onCleanup(
    handle.registerEntryStateCaptor(
      options.key,
      () =>
        pending() ?? {
          accountId: options.accountId(),
          query: options.query(),
          category: options.category(),
          ...options.read(),
        }
    )
  );
  onCleanup(() => {
    disposed = true;
    finish('disposed');
  });
  createEffect(
    on(
      [
        pending,
        options.items,
        options.ready,
        options.busy,
        options.failed,
        options.hasMore,
        options.accountId,
        options.query,
        options.category,
        revision,
      ],
      () => {
        // Editing the dock query/category starts ordinary pagination again, even
        // after an earlier restoration has already finished.
        if (saved && !matches(saved)) setPaginationAllowed(true);
        const anchor = pending();
        if (!anchor) return;
        if (!matches(anchor)) {
          finish('scope_changed');
          return;
        }
        if (options.failed()) {
          finish('source_failed');
          return;
        }
        if (loading || options.busy() || !options.ready() || queued) return;
        queued = true;
        // Responsive row layout and the virtualizer must commit before scrolling.
        queueMicrotask(() => {
          queued = false;
          if (
            disposed ||
            pending() !== anchor ||
            !matches(anchor) ||
            loading ||
            options.busy() ||
            !options.ready()
          )
            return;
          if (options.apply(anchor)) {
            finish('restored');
            return;
          }
          if (
            !options.hasMore() ||
            pages >= MAX_RESTORE_PAGES ||
            lastPage === options.items()
          ) {
            options.apply({ offset: anchor.offset, within: 0 });
            finish('fallback');
            return;
          }
          pages++;
          lastPage = options.items();
          fireAndForget(load(), 'mobile-search');
        });
      }
    )
  );
  return {
    pending: () => pending() !== undefined,
    paginationAllowed,
    cancel: () => {
      setPaginationAllowed(true);
      finish('user_scrolled');
    },
  };
}
