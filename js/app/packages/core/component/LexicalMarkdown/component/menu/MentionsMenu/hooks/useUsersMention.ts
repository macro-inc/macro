import { type UserItem, useQuickAccess } from '@core/context/quickAccess';
import { useEmail } from '@core/context/user';
import type { IUser } from '@core/user';
import { createFreshSearch, FreshSearchPresets } from '@core/util/freshSort';
import { createLazyMemo } from '@solid-primitives/memo';
import type { Accessor } from 'solid-js';
import type { GroupMentionItem } from '../../../../utils/mentionsUtils';

type UseUsersMentionOptions = {
  /** Custom users list if necessary */
  users?: Accessor<IUser[]>;
  searchTerm: Accessor<string>;
  isChannelBlock?: boolean;
  blockId?: string;
};

type UseUsersMentionResult = {
  users: Accessor<UserItem[]>;
  currentUserDomain: Accessor<string | undefined>;
  groups: Accessor<GroupMentionItem[]>;
  usersAndGroups: Accessor<(UserItem | GroupMentionItem)[]>;
};

/** Available group aliases and their match functions */
const GROUPS = [
  {
    alias: 'here',
    match: (term: string) => term === '' || 'here'.startsWith(term),
  },
] as const;

/**
 * Hook for managing user mentions in the mentions menu.
 * Handles user list retrieval, search, filtering, and special groups.
 */
export function useUsersMention(
  options: UseUsersMentionOptions
): UseUsersMentionResult {
  const { users: customUsers, searchTerm, isChannelBlock, blockId } = options;
  const quickAccess = useQuickAccess();
  const currentUserEmail = useEmail();

  const currentUserDomain = () => {
    const email = currentUserEmail();
    return email ? email.split('@')[1] : undefined;
  };

  const usersList = createLazyMemo(() => {
    if (customUsers) {
      const users = customUsers;
      return () =>
        users().map(
          (user) =>
            ({
              id: user.id,
              data: user,
              kind: 'user' as const,
              bucket: 'person' as const,
              sortTimestamp: 0,
              timestamps: {},
              searchText: user.name
                ? user.name + ' | ' + user.email
                : user.email + ' | ' + user.email,
            }) as UserItem
        );
    }
    return quickAccess.useList('person');
  });

  const userSearch = () =>
    createFreshSearch<UserItem>({
      config: FreshSearchPresets.baseUserSearch<UserItem>(
        currentUserDomain,
        (item) => item.data.email
      ),
      getName: (item) => item.searchText,
      getTimestamp: (item) => ({
        lastInteraction: item.timestamps.lastInteraction,
      }),
    });

  const users = createLazyMemo(() => {
    const term = searchTerm();
    if (!term) return usersList()();
    return userSearch()(usersList()(), term).map(({ item }) => item);
  });

  /**
   * Special groups like @here that are only available in channel blocks.
   * These are filtered based on the current search term.
   */
  const groups = (): GroupMentionItem[] => {
    if (!isChannelBlock || !blockId) return [];

    const term = searchTerm().toLowerCase();

    return GROUPS.filter((g) => g.match(term)).map(
      (g): GroupMentionItem => ({
        kind: 'group',
        id: g.alias,
        data: { id: g.alias, groupAlias: g.alias },
      })
    );
  };

  const usersAndGroups = createLazyMemo((): (UserItem | GroupMentionItem)[] => {
    return [...groups(), ...users()];
  });

  return {
    users,
    currentUserDomain,
    groups,
    usersAndGroups,
  };
}
