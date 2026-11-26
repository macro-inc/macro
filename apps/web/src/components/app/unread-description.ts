import { unreadLabel } from '@app/features/notifications-inbox/core/inbox-unread';
import { t } from '@app/lib/i18n';

/**
 * A section's unread count in words, for assistive technology; `undefined`
 * for a section that shows a dot and no number.
 */
export function unreadDescription(
  count: number | undefined
): string | undefined {
  const label = unreadLabel(count);
  if (count === undefined || label === undefined) return undefined;
  if (label !== String(count)) {
    return t('nav.manyUnreadNotifications', { count: 99 });
  }
  return t('nav.unreadNotifications', { count });
}
