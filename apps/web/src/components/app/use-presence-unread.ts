import { useHomeUnreadQuery } from '@app/features/home/queries/use-home-unread-query';
import { createChannelsUnread, createMailUnread } from './view-unread';

/**
 * Which sections hold something unread, for viewers without the unified
 * Notifications view. Mail and Channels read what their views show as
 * unread, as the counted navigation does.
 */
export function usePresenceUnread() {
  const channels = createChannelsUnread();
  const homeUnread = useHomeUnreadQuery();
  const mail = createMailUnread();

  return (id: string): boolean => {
    // Notifications reads the same attention as Home's unread witness; a
    // second live feed here would only duplicate it.
    if (id === 'home' || id === 'notifications') return homeUnread();
    if (id === 'mail') return mail() > 0;
    if (id === 'channels') return channels() > 0;
    return false;
  };
}
