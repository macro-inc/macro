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

/** What a navigation section shows about unread notifications. */
export type NavigationUnread = {
  /** Whether the section holds anything unread: its dot. */
  has: (id: string) => boolean;
  /**
   * How many unread notifications the section holds: the number beside its
   * dot. Undefined for a section that shows no number.
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
 * The notifications inbox rows each section counts; `undefined` is every
 * kind.
 */
const COUNTED_SECTIONS: Record<string, { rowTypes?: readonly InboxRowType[] }> =
  {
    home: {},
    notifications: {},
    'new-home': {},
    channels: { rowTypes: CHANNEL_ROW_TYPES },
    mail: { rowTypes: MAIL_ROW_TYPES },
  };

/**
 * Unread rows of the notifications inbox by section, pushed by the server.
 * A dot and its number always agree, and both match what the Notifications
 * view lists as unread.
 */
function useCountedUnread(options: NavigationUnreadOptions): NavigationUnread {
  const userId = useUserId();
  const passwordsFlag = useFeatureFlag(enablePasswords);
  const counts = createInboxUnread({
    client: getGraphqlSoupClient,
    enabled: () => Boolean(userId()),
    onReconnected: subscribeGraphqlSoupReconnected,
  });

  const rows = (id: string): number | undefined => {
    const section = COUNTED_SECTIONS[id];
    if (!section) return undefined;
    return unreadRows(counts() ?? [], {
      rowTypes: section.rowTypes,
      passwords: !passwordsFlag().loading && passwordsFlag().enabled,
    });
  };

  return {
    has: (id) => (rows(id) ?? 0) > 0,
    count: (id) =>
      id === 'home' && !options.homeIsNotifications ? undefined : rows(id),
  };
}

/**
 * Unified notifications use unread rows for dots and opt-in numbers.
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
  // both the count stream and the presence queries.
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
