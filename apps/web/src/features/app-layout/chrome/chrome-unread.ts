import { useGlobalNotificationSource } from '@components/app/GlobalAppState';
import { notificationIsRead } from '@notifications';
import { createMemo } from 'solid-js';
import type { ChromeDestinationId } from './chrome-destinations';

/**
 * Which view answers for an entity's unread notifications: mail for email
 * threads, Chat for channels — DMs and group chats alike — and Brain for the
 * agent chats. Everything else the notification source carries belongs to a
 * view that does not badge.
 */
const VIEW_BY_ENTITY_TYPE: Readonly<Record<string, ChromeDestinationId>> = {
  email: 'email',
  channel: 'chat',
  chat: 'brain',
};

/**
 * Unread counts per badged view, counted by entity rather than by
 * notification: five unread messages in one channel are one unread
 * conversation, which is what the badge is claiming.
 */
export function createChromeUnreadCounts() {
  const notificationSource = useGlobalNotificationSource();

  return createMemo(() => {
    const entitiesByView = new Map<ChromeDestinationId, Set<string>>();

    for (const notification of notificationSource.notifications()) {
      if (notificationIsRead(notification)) continue;
      const viewId = VIEW_BY_ENTITY_TYPE[notification.entity_type];
      if (!viewId) continue;

      const entities = entitiesByView.get(viewId) ?? new Set<string>();
      entities.add(notification.entity_id);
      entitiesByView.set(viewId, entities);
    }

    const counts = new Map<ChromeDestinationId, number>();
    for (const [viewId, entities] of entitiesByView) {
      counts.set(viewId, entities.size);
    }
    return counts;
  });
}

/** Badges stop counting past this and say "99+" instead. */
export const UNREAD_BADGE_CEILING = 99;

export const unreadBadgeLabel = (count: number) =>
  count > UNREAD_BADGE_CEILING ? `${UNREAD_BADGE_CEILING}+` : `${count}`;
