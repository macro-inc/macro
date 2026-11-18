import { type UserItem, useQuickAccess } from '@core/context/quickAccess';
import { useEmail, useUserId } from '@core/context/user';
import type { IUser } from '@core/user';
import {
  peopleBeforeAgents,
  placeAgentsAfterPeople,
  rankAgentsAfterPeople,
} from '@core/user/people-before-agents';
import {
  createFreshSearch,
  FreshSearchPresets,
  NAME_MATCH_RANKING,
} from '@core/util/freshSort';
import { preservePersonOrder } from '@core/util/ordered-window';
import { createLazyMemo } from '@solid-primitives/memo';
import type { Accessor } from 'solid-js';
import type { GroupMentionItem } from '../../../../utils/mentionsUtils';
import { isBotMentionUser } from '../utils/botMention';

type UseUsersMentionOptions = {
  /** Undefined uses personal search; [] remains a closed, empty scope. */
  users?: Accessor<IUser[] | undefined>;
  transformUsers?: (users: readonly IUser[]) => IUser[];
  searchTerm: Accessor<string>;
  enabled?: Accessor<boolean>;
  /**
   * Whether the composer posts to a channel. Group mentions are an editor
   * configuration, not a block-context lookup: the channels view hosts a
   * conversation outside the block system, where `useMaybeBlockId()` is
   * undefined, and `@here` must still be offered there.
   */
  isChannelBlock?: boolean;
};

type UseUsersMentionResult = {
  error: Accessor<unknown>;
  users: Accessor<UserItem[]>;
  currentUserDomain: Accessor<string | undefined>;
  groups: Accessor<GroupMentionItem[]>;
  usersAndGroups: Accessor<(UserItem | GroupMentionItem)[]>;
  windowKey: Accessor<string | undefined>;
  hasMore: Accessor<boolean>;
  isLoading: Accessor<boolean>;
  isLoadingMore: Accessor<boolean>;
  loadMore: () => Promise<void>;
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
  const { users: customUsers, searchTerm, isChannelBlock } = options;
  const quickAccess = useQuickAccess();
  const usesDirectory = () =>
    options.enabled?.() !== false && customUsers?.() === undefined;
  const workspace = quickAccess.useList({
    buckets: ['person'],
    searchTerm,
    peopleMode: 'mention',
    enabled: usesDirectory,
  });
  const workspaceUsers = workspace.items;
  const currentUserEmail = useEmail();
  const currentUserId = useUserId();

  const currentUserDomain = () => {
    const email = currentUserEmail();
    return email ? email.split('@')[1] : undefined;
  };

  const usersList = createLazyMemo((): UserItem[] => {
    if (options.enabled?.() === false) return [];
    const scoped = customUsers?.();
    if (scoped === undefined && !options.transformUsers)
      return workspaceUsers();
    const window = scoped === undefined ? workspaceUsers() : [];
    const rows = new Map(window.map((item) => [item.id, item]));
    const base = scoped ?? window.map((item) => item.data);
    const users = options.transformUsers?.(base) ?? base;
    // Scoped lists retain their supplied display data. Untouched native rows
    // retain the context/timestamps used to rank that window before limiting.
    return users.map((user): UserItem => {
      const row = rows.get(user.id);
      if (row?.data === user) return row;
      if (row) return { ...row, data: user };
      return {
        id: user.id,
        data: user,
        kind: 'user',
        bucket: 'person',
        sortTimestamp: new Date(
          quickAccess.interactionForUser(user.id) ?? user.lastInteraction ?? 0
        ).getTime(),
        timestamps: {
          lastInteraction:
            quickAccess.interactionForUser(user.id) ?? user.lastInteraction,
        },
        searchText: `${user.name || user.email} | ${user.email}`,
      };
    });
  });

  const userSearch = () => {
    const baseConfig = FreshSearchPresets.baseUserSearch<UserItem>(
      currentUserDomain,
      (item) => item.data.email
    );

    return createFreshSearch<UserItem>({
      config: { ...baseConfig, ...NAME_MATCH_RANKING },
      getName: (item) => item.searchText,
      getDisplayName: (item) => item.data.name || item.data.email,
      isPersonItem: (item) => !isBotMentionUser(item),
      getTimestamp: (item) => ({
        lastInteraction: item.timestamps.lastInteraction,
      }),
    });
  };

  // Macro leads, then people come before the other agents and bots, as in
  // assignee menus. The directory's personal window keeps its own order among
  // people: its rows take the slots the ranking gives people, and search ranks
  // only the rows outside it.
  const users = createLazyMemo(() => {
    const term = searchTerm().trim();
    const list = usersList();
    const results = userSearch()(list, term);
    const order = { viewerId: currentUserId(), mention: true };
    if (!usesDirectory()) {
      if (term) {
        return rankAgentsAfterPeople(results, (item) => item.id, order);
      }
      return peopleBeforeAgents(
        results.map(({ item }) => item),
        (item) => item.id,
        order
      );
    }

    const people = list.filter((item) => !isBotMentionUser(item));
    const extras = results
      .map(({ item }) => item)
      .filter(
        (item) => !isBotMentionUser(item) && item.personOrder === undefined
      );
    const orderedPeople = preservePersonOrder(
      [...people.filter((item) => item.personOrder !== undefined), ...extras],
      people
    );
    const agents = results
      .map(({ item }) => item)
      .filter((item) => isBotMentionUser(item));
    if (!term) {
      return peopleBeforeAgents(
        [...orderedPeople, ...agents],
        (item) => item.id,
        order
      );
    }

    const ranks = new Map(
      results.map((result) => [result.item.id, result.nameMatchRank])
    );
    const rank = (item: UserItem) => ranks.get(item.id) ?? -1;
    return placeAgentsAfterPeople(
      orderedPeople,
      agents.filter((item) => rank(item) >= 0),
      rank,
      (item) => item.id,
      order
    );
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
    // A group leads while browsing and once its alias is typed in full. A
    // partial alias is also the start of people's names ("he" for Helen), so
    // people matching it come first.
    const term = searchTerm().trim().toLowerCase();
    const matched = groups();
    const leading = matched.filter((group) => !term || group.id === term);
    const trailing = matched.filter((group) => !leading.includes(group));
    return [...leading, ...users(), ...trailing];
  });

  return {
    error: () => (usesDirectory() ? workspace.error() : undefined),
    users,
    currentUserDomain,
    groups,
    usersAndGroups,
    windowKey: () => (usesDirectory() ? workspace.windowKey?.() : undefined),
    hasMore: () => usesDirectory() && workspace.hasMore(),
    isLoading: () => usesDirectory() && workspace.isLoading(),
    isLoadingMore: () => usesDirectory() && workspace.isLoadingMore(),
    loadMore: async () => {
      if (usesDirectory()) await workspace.loadMore();
    },
  };
}
