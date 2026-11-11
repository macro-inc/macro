import type { DateValue } from '@core/util/date';
import type { ChannelEntity } from '@entity';
import type { ContactPeoplePolicy } from '@queries/contacts/directory';
import {
  type ContactWindowHost,
  createContactDirectoryWindow,
} from '@queries/contacts/directory-query';
import { type Accessor, createMemo, createSignal, untrack } from 'solid-js';
import { normalizeNameText } from '@core/util/name-match-score';
import { contactUserItem } from './person-items';
import type { EntityItem, QuickAccessList, UserItem } from './types';

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
  // Window setup reads the search term and its own query state. A list built
  // inside a memo must not subscribe that memo to them: every keystroke, cache
  // change, or next page would rebuild the list at page one.
  const window = untrack(() =>
    createContactDirectoryWindow(options.scope, undefined, options.enabled, {
      search: options.search,
      policy: options.policy,
      resetKey: options.resetKey,
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
      return pending ? shown.filter(stillMatches(options.search())) : [];
    }
    shownFor = owner;
    const hints = new Map(
      page.people?.map((person) => [person.userId, person.directMessage])
    );
    return page.users
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
        return {
          ...item,
          personOrder,
          ...(target ? { commandTarget: target } : {}),
        };
      });
  }, []);
  return {
    items,
    windowKey: () => (items().length ? window.windowKey() : undefined),
    totalCount: () => items().length,
    hasMore: () => !!window.data()?.nextCursor,
    isLoading: () => options.enabled() && window.loading(),
    isLoadingMore: loadingMore,
    error: window.error,
    loadMore: async () => {
      if (loadingMore() || !window.data()?.nextCursor) return;
      setLoadingMore(true);
      const input = window.inputKey();
      try {
        for (let page = 0; page < 4; page++) {
          await window.loadNext();
          if (
            input !== window.inputKey() ||
            items().length ||
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
