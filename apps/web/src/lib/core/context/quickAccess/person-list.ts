import type { DateValue } from '@core/util/date';
import { normalizeNameText } from '@core/util/name-match-score';
import type { ChannelEntity } from '@entity';
import type { ContactPeoplePolicy } from '@queries/contacts/directory';
import {
  type ContactWindowHost,
  createContactDirectoryWindow,
} from '@queries/contacts/directory-query';
import { hashKey } from '@tanstack/solid-query';
import { type Accessor, createMemo, createSignal, untrack } from 'solid-js';
import { contactUserItem } from './person-items';
import type { EntityItem, QuickAccessList, UserItem } from './types';

/** Appended pages stay bounded however far a list is scrolled. */
const MAX_LISTED_PEOPLE = 500;

/** Whether a shown person can still be a match for the text typed since. */
function stillMatches(search: string) {
  const terms = normalizeNameText(search).split(' ').filter(Boolean);
  return (item: UserItem) => {
    const label = normalizeNameText(`${item.data.name} ${item.data.email}`);
    return terms.every((term) => label.includes(term));
  };
}

/** One replaceable person window per observer. Channel data is reused only to
 * resolve the bounded winners; no user rows are added to Quick Access's item cache. */
export function createPersonList(options: {
  scope: Accessor<{ userId?: string; host?: ContactWindowHost }>;
  search: Accessor<string>;
  enabled: Accessor<boolean>;
  policy: Accessor<ContactPeoplePolicy>;
  resetKey?: Accessor<string>;
  activity: Accessor<ReadonlyMap<string, DateValue>>;
  conversation: (id: string) => EntityItem<ChannelEntity> | undefined;
  excluded: (id: string) => boolean;
}): QuickAccessList<UserItem> {
  // Property pickers page a replaceable window with explicit controls; menus
  // list each further page below what is already shown.
  const append = () => options.policy().mode !== 'property';
  // Window setup reads the search term and its own query state. A list built
  // inside a memo must not subscribe that memo to them: every keystroke, cache
  // change, or next page would rebuild the list at page one.
  const window = untrack(() =>
    createContactDirectoryWindow(options.scope, undefined, options.enabled, {
      search: options.search,
      policy: options.policy,
      resetKey: options.resetKey,
      // Menus debounce their own query. Waiting again lands people after
      // every other source and moves the rows under the highlight.
      debounceMs: untrack(options.policy).mode === 'property' ? 200 : 0,
    })
  );
  const [loadingMore, setLoadingMore] = createSignal(false);
  let shownFor: string | undefined;
  let listed: { key: string; first: UserItem[]; later: UserItem[] } | undefined;
  /** What the listed pages belong to: the account, the text, and who is eligible. */
  const listKey = () => {
    const scope = options.scope();
    return hashKey([
      scope.userId,
      scope.host?.clientId,
      normalizeNameText(options.search()),
      options.policy(),
      options.resetKey?.(),
    ]);
  };
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
      return pending ? shown.filter(stillMatches(options.search())) : [];
    }
    shownFor = owner;
    const hints = new Map(
      page.people?.map((person) => [person.userId, person.directMessage])
    );
    const fresh = page.users
      .filter((user) => !options.excluded(user.id))
      .map((user): UserItem => {
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
        return target ? { ...item, commandTarget: target } : item;
      });
    const key = listKey();
    if (!append() || listed?.key !== key)
      listed = { key, first: fresh, later: [] };
    else if (window.continued()) {
      const known = new Set(
        [...listed.first, ...listed.later].map((item) => item.id)
      );
      listed = {
        ...listed,
        later: [
          ...listed.later,
          ...fresh.filter((item) => !known.has(item.id)),
        ],
      };
    } else {
      // A re-read of the first page keeps the pages already listed below it.
      const first = new Set(fresh.map((item) => item.id));
      listed = {
        key,
        first: fresh,
        later: listed.later.filter((item) => !first.has(item.id)),
      };
    }
    return [...listed.first, ...listed.later].map(
      (item, personOrder): UserItem => ({ ...item, personOrder })
    );
  }, []);
  const hasNextPage = () =>
    !!window.data()?.nextCursor &&
    (!append() || items().length < MAX_LISTED_PEOPLE);
  return {
    items,
    // Appended pages are one growing window; only a new list is a new window.
    windowKey: () => {
      if (!items().length) return undefined;
      return append() ? listKey() : window.windowKey();
    },
    totalCount: () => items().length,
    hasMore: hasNextPage,
    isLoading: () => options.enabled() && window.loading(),
    isLoadingMore: loadingMore,
    error: window.error,
    loadMore: async () => {
      if (loadingMore() || !hasNextPage()) return;
      setLoadingMore(true);
      const input = window.inputKey();
      const listedBefore = append() ? items().length : 0;
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
