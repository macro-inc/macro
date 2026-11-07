import type { DateValue } from '@core/util/date';
import type { ChannelEntity } from '@entity';
import type { ContactPeoplePolicy } from '@queries/contacts/directory';
import {
  type ContactWindowHost,
  createContactDirectoryWindow,
} from '@queries/contacts/directory-query';
import { type Accessor, createMemo, createSignal } from 'solid-js';
import { contactUserItem } from './person-items';
import type { EntityItem, QuickAccessList, UserItem } from './types';

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
  const window = createContactDirectoryWindow(
    options.scope,
    undefined,
    options.enabled,
    {
      search: options.search,
      policy: options.policy,
      resetKey: options.resetKey,
    }
  );
  const [loadingMore, setLoadingMore] = createSignal(false);
  const items = createMemo(() => {
    const page = window.data();
    if (!page) return [];
    const hints = new Map(
      page.people?.map((person) => [person.userId, person.directMessage])
    );
    return page.users
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
  });
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
