import { createUserScopedStorage } from '@core/util/userScopedStorage';
import { type InboxStatus, parseInboxFilters } from './core/inbox-filters';

/** Where each user's inbox filters are kept between visits. */
export const inboxFilterStorage = createUserScopedStorage(
  'macro:notifications:filters:v1'
);

/** Open the inbox at All or Unread the next time it mounts for this user. */
export function saveInboxStatus(userId: string, status: InboxStatus) {
  const filters = parseInboxFilters(inboxFilterStorage.read(userId));
  inboxFilterStorage.write(userId, JSON.stringify({ ...filters, status }));
}
