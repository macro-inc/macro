import { type UserItem, useQuickAccess } from '@core/context/quickAccess';
import { UNANSWERED_SEARCH_LIMIT_MS } from '@core/context/quickAccess/projected-list';
import { useEmail, useUserId } from '@core/context/user';
import type { IUser } from '@core/user';
import {
  leadsPeople,
  type MenuOrder,
  peopleBeforeAgents,
  placeAgentsAfterPeople,
  rankAgentsAfterPeople,
} from '@core/user/people-before-agents';
import { deferredGate } from '@core/util/debounce';
import { fireAndForget } from '@core/util/fireAndForget';
import {
  createFreshSearch,
  FreshSearchPresets,
  type FreshSortResult,
  NAME_MATCH_RANKING,
} from '@core/util/freshSort';
import { preservePersonOrder } from '@core/util/ordered-window';
import { useMentionListPriority } from '@queries/contacts/lists';
import { createLazyMemo } from '@solid-primitives/memo';
import {
  type Accessor,
  createEffect,
  createMemo,
  createSignal,
  on,
  untrack,
} from 'solid-js';
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
  users: Accessor<UserItem[]>;
  currentUserDomain: Accessor<string | undefined>;
  groups: Accessor<GroupMentionItem[]>;
  usersAndGroups: Accessor<(UserItem | GroupMentionItem)[]>;
  windowKey: Accessor<string | undefined>;
  hasMore: Accessor<boolean>;
  isLoading: Accessor<boolean>;
  /** Whether the menu lists only the rows that lead the people still loading. */
  waitingForPeople: Accessor<boolean>;
  /** Whether the people still loading join rows already placed (Macro, or
   * agents held back until they can be placed after the people). */
  holdsRows: Accessor<boolean>;
  /** Whether the rows held for the people still loading show as loading yet. */
  showsLoading: Accessor<boolean>;
  /** Whether the directory's read for the term failed, or has not answered
   * in time, and lists no one. */
  peopleFailed: Accessor<boolean>;
  /** Reads the failed directory window again, waiting for it as on opening. */
  retryPeople: () => Promise<void>;
  isLoadingMore: Accessor<boolean>;
  loadMore: () => Promise<void>;
};

type DirectoryAnswer = 'unread' | 'reading' | 'answered';

/**
 * How long the menu waits for the local cache before listing the server's
 * people: longer than a cold cache read usually takes, short enough that a
 * busy or ownerless cache does not leave People loading.
 */
const PEOPLE_CACHE_BUDGET_MS = 2_000;

/**
 * How long People's reserved rows stay blank before they shimmer: a healthy
 * cache answers sooner, so an ordinary open shows no loading state.
 */
const LOADING_ROWS_DELAY_MS = 500;

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
    peopleListPriority: useMentionListPriority(),
    peopleLocalBudgetMs: PEOPLE_CACHE_BUDGET_MS,
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

  // Until the directory first answers after the menu opens or a retry, it is
  // not known where the agents go among the people. Later reads keep the
  // people who still match while they run, so typing does not wait again. A
  // directory that has not answered by the time other menus stop saying the
  // cache is searching gets its agents listed after all, with the same
  // message and Retry as a failed read.
  const listsPeople = () => usersList().some((item) => !isBotMentionUser(item));

  // The directory does not read a failed window again until its input
  // changes. The menu reads it once more by itself, since a busy cache's read
  // timeout usually clears, and offers Retry only when that read fails too.
  const opens = createMemo(
    (count: number) => (usesDirectory() ? count : count + 1),
    0
  );
  const readKey = () => `${opens()}\n${searchTerm()}`;
  const [rereadFor, setRereadFor] = createSignal<string>();
  const [rereadDone, setRereadDone] = createSignal<string>();
  const failedRead = () =>
    usesDirectory() &&
    !workspace.isLoading() &&
    workspace.error() != null &&
    !listsPeople();
  const rereadSpent = () => rereadDone() === readKey();
  const rereadOnce = async (key: string) => {
    setRereadFor(key);
    try {
      await workspace.retry?.();
    } finally {
      setRereadDone(key);
    }
  };
  // A failed read drops the people it listed, so the menu waits for the
  // re-read of it as it does for the first answer.
  const awaitingReread = () =>
    !listsPeople() &&
    rereadDone() !== readKey() &&
    (rereadFor() === readKey() || failedRead());
  createEffect(
    on(failedRead, (failed) => {
      const key = untrack(readKey);
      if (failed && untrack(rereadFor) !== key)
        fireAndForget(rereadOnce(key), 'mentions-menu');
    })
  );

  const [attempt, setAttempt] = createSignal(0);
  const firstAnswer = createMemo<{ attempt: number; state: DirectoryAnswer }>(
    (previous) => {
      const current = attempt();
      const state = previous.attempt === current ? previous.state : 'unread';
      const answer = (next: DirectoryAnswer) => ({
        attempt: current,
        state: next,
      });
      if (!usesDirectory()) return answer('unread');
      if (state === 'answered' || listsPeople()) return answer('answered');
      if (workspace.isLoading()) return answer('reading');
      // A failed read is no answer: a read that follows it (a retry, or the
      // cache changing owner) is waited for like the first.
      if (failedRead()) return answer(state);
      return answer(state === 'reading' ? 'answered' : 'unread');
    },
    { attempt: 0, state: 'unread' }
  );
  const awaitingDirectory = createMemo(
    () =>
      usesDirectory() &&
      (firstAnswer().state !== 'answered' || awaitingReread())
  );
  // As other contact menus do, a read that failed again offers Retry.
  const failedTwice = () => failedRead() && rereadSpent();
  const [restarting, setRestarting] = createSignal(false);
  const readPending = () =>
    awaitingDirectory() && !failedTwice() && !restarting();
  const waitedTooLong = deferredGate(readPending, UNANSWERED_SEARCH_LIMIT_MS);
  const waitingForPeople = () => readPending() && !waitedTooLong();
  const showsLoading = deferredGate(waitingForPeople, LOADING_ROWS_DELAY_MS);

  // People never goes missing without a word: a read still pending after the
  // wait says so too, since nothing else would until it settles.
  const peopleFailed = () =>
    !listsPeople() &&
    (failedTwice() || (awaitingDirectory() && !waitingForPeople()));

  // Macro leads, then people come before the other agents and bots, as in
  // assignee menus. The directory's personal window keeps its own order among
  // people: its rows take the slots the ranking gives people, and search ranks
  // only the rows outside it. While its people load, only the rows that lead
  // them all are listed, and the agents that will follow them are held back
  // so that none is shown in a place a person is about to take.
  const listing = createLazyMemo((): { rows: UserItem[]; agents: number } => {
    const term = searchTerm().trim();
    const list = usersList();
    const results = userSearch()(list, term);
    const order = { viewerId: currentUserId(), mention: true };
    if (waitingForPeople()) {
      const agents = results.filter(
        (result) => !term || result.nameMatchRank >= 0
      );
      const rows = agents
        .filter((result) =>
          leadsPeople(
            result.item.id,
            order,
            term ? result.nameMatchRank : undefined
          )
        )
        .map((result) => result.item);
      return { rows, agents: agents.length };
    }

    return { rows: orderedUsers(term, list, results, order), agents: 0 };
  });

  function orderedUsers(
    term: string,
    list: UserItem[],
    results: FreshSortResult<UserItem>[],
    order: MenuOrder
  ): UserItem[] {
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
  }

  const users = () => listing().rows;

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
    users,
    currentUserDomain,
    groups,
    usersAndGroups,
    windowKey: () => (usesDirectory() ? workspace.windowKey?.() : undefined),
    hasMore: () => usesDirectory() && workspace.hasMore(),
    isLoading: () => usesDirectory() && workspace.isLoading(),
    waitingForPeople,
    holdsRows: () => waitingForPeople() && listing().agents > 0,
    showsLoading,
    peopleFailed,
    retryPeople: async () => {
      // A read still pending keeps its wait; lowering it for a moment starts
      // the wait again, so Retry holds the rows as opening does.
      setRestarting(true);
      setAttempt((value) => value + 1);
      setRestarting(false);
      await workspace.retry?.();
    },
    isLoadingMore: () => usesDirectory() && workspace.isLoadingMore(),
    loadMore: async () => {
      if (usesDirectory()) await workspace.loadMore();
    },
  };
}
