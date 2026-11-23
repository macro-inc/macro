import type { DateValue } from '@core/util/date';
import { normalizeNameText } from '@core/util/name-match-score';
import type { ChannelEntity } from '@entity';
import type { ContactPeoplePolicy } from '@queries/contacts/directory';
import { createContactDirectoryList } from '@queries/contacts/directory-list';
import type { ContactWindowHost } from '@queries/contacts/directory-query';
import { type Accessor, createMemo, createSignal, untrack } from 'solid-js';
import { contactUserItem } from './person-items';
import type { EntityItem, QuickAccessList, UserItem } from './types';
import { keepUnchangedRows } from './unchanged-rows';

/** Whether a shown person can still be a match for the text typed since. */
function stillMatches(search: string) {
  const terms = normalizeNameText(search).split(' ').filter(Boolean);
  return (item: UserItem) => {
    const label = normalizeNameText(`${item.data.name} ${item.data.email}`);
    return terms.every((term) => label.includes(term));
  };
}

/** One growing person list per observer. Channel data is reused only to
 * resolve the bounded winners; no user rows are added to Quick Access's item cache. */
export function createPersonList(options: {
  scope: Accessor<{ userId?: string; host?: ContactWindowHost }>;
  search: Accessor<string>;
  enabled: Accessor<boolean>;
  policy: Accessor<ContactPeoplePolicy>;
  resetKey?: Accessor<string>;
  localBudgetMs?: number;
  activity: Accessor<ReadonlyMap<string, DateValue>>;
  /** Members of the viewer's team, to rank a page the server did not. */
  teammates?: Accessor<ReadonlySet<string>>;
  conversation: (id: string) => EntityItem<ChannelEntity> | undefined;
  excluded: (id: string) => boolean;
}): QuickAccessList<UserItem> {
  // Further pages are listed below what is already shown, up to a bound.
  // Window setup reads the search term and its own query state. A list built
  // inside a memo must not subscribe that memo to them: every keystroke, cache
  // change, or next page would rebuild the list at page one.
  const window = untrack(() =>
    createContactDirectoryList(options.scope, undefined, options.enabled, {
      search: options.search,
      policy: options.policy,
      resetKey: options.resetKey,
      eligible: (user) => !options.excluded(user.id),
      teammates: options.teammates,
      directMessages: options.activity,
      // Menus debounce their own query. Waiting again lands people after
      // every other source and moves the rows under the highlight.
      debounceMs: untrack(options.policy).mode === 'property' ? 200 : 0,
      localBudgetMs: options.localBudgetMs,
    })
  );
  const [loadingMore, setLoadingMore] = createSignal(false);
  let shownFor: string | undefined;
  const items = createMemo<UserItem[]>((shown) => {
    const page = window.data();
    const scope = options.scope();
    const owner = `${scope.userId ?? ''}\n${scope.host?.clientId ?? ''}`;
    if (!page) {
      // The window drops its page while the next read is pending: after each
      // keystroke, contact change, and page request. Keep showing the rows
      // that still match rather than emptying the list until it lands.
      const pending =
        options.enabled() &&
        shownFor === owner &&
        window.loading() &&
        !window.error();
      return keepUnchangedRows(
        shown,
        pending ? shown.filter(stillMatches(options.search())) : []
      );
    }
    shownFor = owner;
    const hints = new Map(
      page.people?.map((person) => [person.userId, person.directMessage])
    );
    return keepUnchangedRows(
      shown,
      page.users
        .filter((user) => !options.excluded(user.id))
        .map((user, personOrder): UserItem => {
          const item = contactUserItem({
            id: user.id,
            email: user.email,
            name: user.name,
            lastInteraction:
              user.lastInteraction ?? options.activity().get(user.id),
          });
          const dm = hints.get(user.id);
          const target =
            dm && options.policy().mode === 'command' && options.search().trim()
              ? options.conversation(dm.id)
              : undefined;
          // A server page read for a late cache is in no meaningful order
          // unless its text named people and the list ranked them. Those
          // rows keep their place; callers rank the others as they rank
          // other people.
          const order = page.localLate && !page.named ? {} : { personOrder };
          return target
            ? { ...item, commandTarget: target, ...order }
            : { ...item, ...order };
        })
    );
  }, []);
  // A failed or pending read offers no continuation; a failed page waits for
  // an explicit retry, so a scrolled menu cannot retry it in a loop.
  const hasNextPage = () => !!window.data()?.nextCursor;
  return {
    items,
    // Appended pages are one growing window; only a new list is a new window.
    windowKey: () => (items().length ? window.windowKey() : undefined),
    totalCount: () => items().length,
    hasMore: hasNextPage,
    isLoading: () => options.enabled() && window.loading(),
    isLoadingMore: loadingMore,
    error: window.error,
    retry: async () => {
      await window.retry();
    },
    loadMore: async () => {
      if (loadingMore() || !hasNextPage()) return;
      setLoadingMore(true);
      const input = window.inputKey();
      const listedBefore = items().length;
      try {
        for (let page = 0; page < 4; page++) {
          await window.loadNext();
          if (
            input !== window.inputKey() ||
            items().length > listedBefore ||
            !window.data()?.nextCursor
          )
            break;
        }
      } finally {
        setLoadingMore(false);
      }
    },
  };
}
