import { hashKey } from '@tanstack/solid-query';
import {
  type Accessor,
  createEffect,
  createMemo,
  createSignal,
  on,
} from 'solid-js';
import { createContactResolution } from './lookup-query';
import { useContactDirectoryScope } from './use-directory';

const ALIAS_WINDOW_SIZE = 50;

/** Resolve only the current CRM result window, not the complete personal directory.
 * CRM's own source owns its loaded pages; private contact resolutions/history do not grow with them. */
export function createContactAliasWindow<T extends { id: string }>(options: {
  rows: Accessor<readonly T[]>;
  email: (row: T) => string;
  search: Accessor<string>;
  enabled: Accessor<boolean>;
  resolveUsers?: Accessor<boolean>;
  hasMore: Accessor<boolean>;
  loadMore: () => Promise<void>;
}) {
  const scope = useContactDirectoryScope();
  const [offset, setOffset] = createSignal(0);
  const [loadingMore, setLoadingMore] = createSignal(false);
  let version = 0;
  createEffect(
    on(
      [
        options.search,
        options.enabled,
        () => scope().userId,
        () => scope().host,
      ],
      () => {
        version++;
        setOffset(0);
      }
    )
  );
  const start = () =>
    Math.min(
      offset(),
      Math.max(
        0,
        Math.floor((options.rows().length - 1) / ALIAS_WINDOW_SIZE) *
          ALIAS_WINDOW_SIZE
      )
    );
  const rows = createMemo(() =>
    options.enabled()
      ? options.rows().slice(start(), start() + ALIAS_WINDOW_SIZE)
      : []
  );
  const resolution = createContactResolution(
    scope,
    () => ({
      kind: 'emails',
      values: rows().map(options.email).filter(Boolean),
    }),
    () => options.enabled() && options.resolveUsers?.() !== false
  );
  return {
    rows,
    windowKey: () =>
      options.enabled()
        ? hashKey([options.search(), start(), rows().map((row) => row.id)])
        : undefined,
    users: () => resolution.data()?.users ?? [],
    loading: resolution.loading,
    error: resolution.error,
    hasMore: () =>
      options.enabled() &&
      (start() + rows().length < options.rows().length || options.hasMore()),
    isLoadingMore: loadingMore,
    loadMore: async () => {
      if (!options.enabled() || loadingMore()) return;
      const pendingVersion = version;
      const search = options.search();
      const viewer = scope().userId;
      const next = start() + ALIAS_WINDOW_SIZE;
      setLoadingMore(true);
      try {
        if (next >= options.rows().length && options.hasMore())
          await options.loadMore();
        if (
          pendingVersion === version &&
          options.enabled() &&
          options.search() === search &&
          scope().userId === viewer &&
          next < options.rows().length
        )
          setOffset(next);
      } finally {
        setLoadingMore(false);
      }
    },
  };
}
