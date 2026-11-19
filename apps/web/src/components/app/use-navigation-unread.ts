import type { InboxRowType } from '@app/features/notifications-inbox/core/inbox-row';
import {
  CHANNEL_ROW_TYPES,
  MAIL_ROW_TYPES,
  unreadRows,
} from '@app/features/notifications-inbox/core/inbox-unread';
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

/** Whether sections show their unread numbers beside their dots. */
const showsNumbers = () => isFeatureEnabled(enableNavigationUnreadCounts);

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
 * Each section's unread items. Notifications counts the unread rows of the
 * notifications inbox, pushed by the server. While numbers show, Mail counts
 * its Important tab's unread threads and Channels its conversations with an
 * unread dot, by their views' own queries. Those queries run only while
 * numbers show; without numbers the two sections' dots come from their inbox
 * rows. A dot and its number always agree.
 */
function useCountedUnread(options: NavigationUnreadOptions): NavigationUnread {
  const userId = useUserId();
  const passwordsFlag = useFeatureFlag(enablePasswords);
  const inbox = createInboxUnread({
    client: getGraphqlSoupClient,
    enabled: () => Boolean(userId()),
    onReconnected: subscribeGraphqlSoupReconnected,
  });
  const views = createMemo(() =>
    showsNumbers()
      ? {
          mail: createMailUnread({ exact: true }),
          channels: createChannelsUnread(),
        }
      : undefined
  );

  const inboxRows = (rowTypes?: readonly InboxRowType[]) =>
    unreadRows(inbox() ?? [], {
      rowTypes,
      passwords: !passwordsFlag().loading && passwordsFlag().enabled,
    });
  const unread = (id: string): number | undefined => {
    if (id === 'home' || id === 'notifications') return inboxRows();
    const counted = views();
    if (id === 'mail') return counted?.mail() ?? inboxRows(MAIL_ROW_TYPES);
    if (id === 'channels')
      return counted?.channels() ?? inboxRows(CHANNEL_ROW_TYPES);
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
    count: (id) => (showsNumbers() ? source()?.count(id) : undefined),
  };
}
