import { unreadRows } from '@app/features/notifications-inbox/core/inbox-unread';
import { createInboxUnread } from '@app/features/notifications-inbox/queries/inbox-unread';
import { useFeatureFlag } from '@app/lib/analytics/posthog';
import {
  enableNavigationUnreadCounts,
  enablePasswords,
  enableUnifiedNotifications,
  isFeatureEnabled,
} from '@core/constant/featureFlags';
import { useUserId } from '@core/context/user';
import {
  getGraphqlSoupClient,
  subscribeGraphqlSoupReconnected,
} from '@service-storage/graphql-soup';
import { createMemo } from 'solid-js';
import { usePresenceUnread } from './use-presence-unread';
import { createChannelsUnread, createMailUnread } from './view-unread';

/** What a navigation section shows about unread notifications. */
export type NavigationUnread = {
  /** Whether the section holds anything unread: its dot. */
  has: (id: string) => boolean;
  /**
   * How many unread items the section's own view shows: the number beside
   * its dot. Undefined for a section that shows no number.
   */
  count: (id: string) => number | undefined;
};

/** Where the navigation shows unread state. */
export type NavigationUnreadOptions = {
  /**
   * Home stands in for Notifications, as the mobile dock's bell does, so it
   * carries the number. Beside a Notifications section it keeps a dot: the
   * number would repeat the one next to it.
   */
  homeIsNotifications?: boolean;
};

/**
 * Each section's unread items, counted by the rule its view lists them by:
 * Notifications by the unread rows of the notifications inbox, pushed by the
 * server; Mail by its Important tab's unread threads; Channels by its
 * conversations with an unread dot. A dot and its number always agree.
 */
function useCountedUnread(options: NavigationUnreadOptions): NavigationUnread {
  const userId = useUserId();
  const passwordsFlag = useFeatureFlag(enablePasswords);
  const inbox = createInboxUnread({
    client: getGraphqlSoupClient,
    enabled: () => Boolean(userId()),
    onReconnected: subscribeGraphqlSoupReconnected,
  });
  const mail = createMailUnread();
  const channels = createChannelsUnread();

  const inboxRows = () =>
    unreadRows(inbox() ?? [], {
      passwords: !passwordsFlag().loading && passwordsFlag().enabled,
    });
  const unread = (id: string): number | undefined => {
    if (id === 'home' || id === 'notifications') return inboxRows();
    if (id === 'mail') return mail();
    if (id === 'channels') return channels();
    return undefined;
  };

  return {
    has: (id) => (unread(id) ?? 0) > 0,
    count: (id) =>
      id === 'home' && !options.homeIsNotifications ? undefined : unread(id),
  };
}

/**
 * Unified notifications use counted sections for dots and opt-in numbers.
 * Legacy navigation uses presence dots.
 */
export function useNavigationUnread(
  options: NavigationUnreadOptions = {}
): NavigationUnread {
  const unified = useFeatureFlag(enableUnifiedNotifications);
  const mode = createMemo(() => {
    if (unified().loading) return 'undecided';
    return unified().enabled ? 'counted' : 'presence';
  });
  // Each source lives only while its mode holds, so a viewer never runs
  // both the inbox count stream and Home's presence query.
  const source = createMemo((): NavigationUnread | undefined => {
    if (mode() === 'undecided') return undefined;
    if (mode() === 'counted') return useCountedUnread(options);
    const has = usePresenceUnread();
    return { has, count: () => undefined };
  });

  return {
    has: (id) => source()?.has(id) ?? false,
    count: (id) =>
      isFeatureEnabled(enableNavigationUnreadCounts)
        ? source()?.count(id)
        : undefined,
  };
}
