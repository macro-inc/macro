import { hashKey } from '@tanstack/solid-query';
import {
  type Accessor,
  createEffect,
  createMemo,
  createSignal,
  on,
} from 'solid-js';
import { MAX_CONTACT_LOOKUP } from './lookup';
import { createContactResolution } from './lookup-query';
import { useContactDirectoryScope } from './use-directory';

type ContactUsers = NonNullable<
  ReturnType<ReturnType<typeof createContactResolution>['data']>
>['users'];

const ALIAS_WINDOW_SIZE = 50;
const MAX_LISTED_ALIASES = MAX_CONTACT_LOOKUP;

/** Resolve only the listed CRM results, not the complete personal directory.
 * Each further page is listed below the earlier ones, up to one lookup batch;
 * CRM's own source owns its loaded pages. */
export function createContactAliasWindow<T extends { id: string }>(options: {
  rows: Accessor<readonly T[]>;
  email: (row: T) => string | null | undefined;
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
  const listed = () =>
    Math.min(MAX_LISTED_ALIASES, offset() + ALIAS_WINDOW_SIZE);
  const rows = createMemo(() =>
    options.enabled() ? options.rows().slice(0, listed()) : []
  );
  const resolution = createContactResolution(
    scope,
    () => ({
      kind: 'emails',
      values: rows()
        .map(options.email)
        .filter(
          (email): email is string =>
            typeof email === 'string' && email.length > 0
        ),
    }),
    () => options.enabled() && options.resolveUsers?.() !== false
  );
  // Resolution restarts whenever the listed rows change. Keep the users it
  // already found for emails still listed until the new answer lands, so a
  // contact does not split from its Macro user and merge again.
  const users = createMemo<ContactUsers>((previous) => {
    const resolved = resolution.data()?.users;
    if (resolved) return resolved;
    if (!resolution.loading()) return [];
    const emails = new Set(
      rows().map((row) => options.email(row)?.trim().toLowerCase())
    );
    return previous.filter((user) => emails.has(user.email.toLowerCase()));
  }, []);
  return {
    rows,
    // One growing list per search: rows arriving, refreshing, or a further
    // page listed below are not a new window.
    windowKey: () =>
      options.enabled() ? hashKey([options.search()]) : undefined,
    users,
    loading: resolution.loading,
    error: resolution.error,
    hasMore: () =>
      options.enabled() &&
      listed() < MAX_LISTED_ALIASES &&
      (listed() < options.rows().length || options.hasMore()),
    isLoadingMore: loadingMore,
    loadMore: async () => {
      if (!options.enabled() || loadingMore()) return;
      const pendingVersion = version;
      const search = options.search();
      const viewer = scope().userId;
      const next = listed();
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
