import { type UserItem, useQuickAccess } from '@core/context/quickAccess';
import { useEmail } from '@core/context/user';
import type { IUser } from '@core/user';
import { createFreshSearch, FreshSearchPresets } from '@core/util/freshSort';
import { createLazyMemo } from '@solid-primitives/memo';
import type { Accessor } from 'solid-js';
import type { GroupMentionItem } from '../../../../utils/mentionsUtils';
import { isBotMentionUser } from '../utils/botMention';

type UseUsersMentionOptions = {
  /** Custom users list if necessary */
  users?: Accessor<IUser[]>;
  searchTerm: Accessor<string>;
  /**
   * Whether the composer posts to a channel. Group mentions are an editor
   * configuration, not a block-context lookup: the channels view hosts a
   * conversation outside the block system, where `useMaybeBlockId()` is
   * undefined, and `@here` must still be offered there.
   */
  isChannelBlock?: boolean;
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

const BOT_MENTION_BOOST = 10;

/**
 * Hook for managing user mentions in the mentions menu.
 * Handles user list retrieval, search, filtering, and special groups.
 */
export function useUsersMention(
  options: UseUsersMentionOptions
): UseUsersMentionResult {
  const { users: customUsers, searchTerm, isChannelBlock } = options;
  const quickAccess = useQuickAccess();
  const workspaceUsers = quickAccess.useList('person').items;
  const currentUserEmail = useEmail();

  const currentUserDomain = () => {
    const email = currentUserEmail();
    return email ? email.split('@')[1] : undefined;
  };

  const usersList = createLazyMemo((): UserItem[] => {
    if (!customUsers) return workspaceUsers();

    // Custom lists scope who can be mentioned, but should retain the same
    // interaction ranking as the document body's workspace list.
    const workspaceUsersById = new Map(
      workspaceUsers().map((item) => [item.id, item])
    );
    return customUsers().map((user) => ({
      id: user.id,
      data: user,
      kind: 'user',
      bucket: 'person',
      sortTimestamp: workspaceUsersById.get(user.id)?.sortTimestamp ?? 0,
      timestamps: {
        lastInteraction:
          workspaceUsersById.get(user.id)?.timestamps.lastInteraction ??
          user.lastInteraction,
      },
      searchText: `${user.name || user.email} | ${user.email}`,
    }));
  });

  const userSearch = () => {
    const baseConfig = FreshSearchPresets.baseUserSearch<UserItem>(
      currentUserDomain,
      (item) => item.data.email
    );

    return createFreshSearch<UserItem>({
      config: {
        ...baseConfig,
        boostFn: (item) =>
          (baseConfig.boostFn?.(item) ?? 0) +
          (isBotMentionUser(item) ? BOT_MENTION_BOOST : 0),
      },
      getName: (item) => item.searchText,
      getTimestamp: (item) => ({
        lastInteraction: item.timestamps.lastInteraction,
      }),
    });
  };

  const users = createLazyMemo(() => {
    const term = searchTerm();
    const list = usersList();
    return userSearch()(list, term).map(({ item }) => item);
  });

  /**
   * Special groups like @here that are only available in channel composers.
   * These are filtered based on the current search term.
   */
  const groups = (): GroupMentionItem[] => {
    if (!isChannelBlock) return [];

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
