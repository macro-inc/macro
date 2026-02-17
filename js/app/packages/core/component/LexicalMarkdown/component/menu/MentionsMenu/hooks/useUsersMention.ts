import type { Accessor } from 'solid-js';
import { createLazyMemo } from '@solid-primitives/memo';
import { useQuickAccess, type UserItem } from '@core/context/quickAccess';
import type { IUser } from '@core/user';
import { createFreshSearch, FreshSearchPresets } from '@core/util/freshSort';
import { useEmail } from '@core/context/user';
import type { GroupMentionItem } from '../../../../utils/mentionsUtils';

export type UseUsersMentionOptions = {
  /** Custom users list if necessary */
  users?: Accessor<IUser[]>;
  /** The search term to filter users by */
  searchTerm: Accessor<string>;
  /** Whether we're in a channel block (enables special groups like @here) */
  isChannelBlock?: boolean;
  /** The current block ID (required for special groups to work) */
  blockId?: string;
};

export type UseUsersMentionResult = {
  /** Filtered users based on search term */
  users: Accessor<UserItem[]>;
  /** The current user's email domain */
  currentUserDomain: Accessor<string | undefined>;
  /** Special groups like @here (only available in channels) */
  specialGroups: Accessor<GroupMentionItem[]>;
  /** Combined users and special groups for the bucket */
  usersAndGroups: Accessor<(UserItem | GroupMentionItem)[]>;
};

/** Available special group aliases and their match functions */
const SPECIAL_GROUPS = [
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

  const currentUserDomain = createLazyMemo(() => {
    const email = currentUserEmail();
    return email ? email.split('@')[1] : undefined;
  });

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

  const userSearch = createLazyMemo(() =>
    createFreshSearch<UserItem>(
      FreshSearchPresets.baseUserSearch<UserItem>(
        currentUserDomain,
        (item) => item.data.email
      ),
      (item) => item.searchText,
      (_) => false,
      (item) => ({ lastInteraction: item.timestamps.lastInteraction })
    )
  );

  const users = createLazyMemo(() => {
    const term = searchTerm();
    if (!term) return usersList()();
    return userSearch()(usersList()(), term).map(({ item }) => item);
  });

  /**
   * Special groups like @here that are only available in channel blocks.
   * These are filtered based on the current search term.
   */
  const specialGroups = createLazyMemo((): GroupMentionItem[] => {
    // Only show special groups in channel blocks with a valid block ID
    if (!isChannelBlock || !blockId) return [];

    const term = searchTerm().toLowerCase();

    return SPECIAL_GROUPS.filter((g) => g.match(term)).map(
      (g): GroupMentionItem => ({
        kind: 'group',
        id: g.alias,
        data: { id: g.alias, groupAlias: g.alias },
      })
    );
  });

  /**
   * Combined list of special groups and users.
   * Groups appear first, followed by users.
   */
  const usersAndGroups = createLazyMemo((): (UserItem | GroupMentionItem)[] => {
    const groups = specialGroups();
    const userList = users();
    return [...groups, ...userList];
  });

  return {
    users,
    currentUserDomain,
    specialGroups,
    usersAndGroups,
  };
}
