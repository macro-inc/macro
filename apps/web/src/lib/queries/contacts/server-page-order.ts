import type { IUser } from '@core/user/types';
import type { DateValue } from '@core/util/date';
import { toDate } from 'date-fns';
import type { ContactDirectoryPage } from './directory';

/** The people the viewer works with, known without the local cache. */
type WorkingRelationships = {
  /** Latest direct-message activity per person the viewer has a DM with. */
  directMessages: ReadonlyMap<string, DateValue>;
  teammates: ReadonlySet<string>;
};

/**
 * Orders the first server page as the local ranking orders the same people.
 * The people the typed text names come first: direct-message partners, most
 * recent first, then teammates, then everyone else, with exact matches ahead
 * of word-start ones within each. The server's looser matches follow, in the
 * same three groups. People equal in all of that keep the server's order.
 */
export function orderServerPage(
  users: IUser[],
  named: NonNullable<ContactDirectoryPage['named']>,
  working: WorkingRelationships
): IUser[] {
  const exact = new Set(named.exact);
  const wordStart = new Set(named.wordStart);
  const rows = users.map((user, index) => {
    const messaged = toDate(working.directMessages.get(user.id) ?? 0);
    // A missing or unreadable time counts as no direct message.
    const lastMessage = Math.max(messaged.getTime() || 0, 0);
    let closeness = 2;
    if (lastMessage > 0) closeness = 0;
    else if (working.teammates.has(user.id.toLowerCase())) closeness = 1;

    let match = 2;
    if (exact.has(user.id)) match = 0;
    else if (wordStart.has(user.id)) match = 1;

    return { user, index, loose: match === 2, closeness, match, lastMessage };
  });
  return rows
    .sort(
      (a, b) =>
        Number(a.loose) - Number(b.loose) ||
        a.closeness - b.closeness ||
        a.match - b.match ||
        b.lastMessage - a.lastMessage ||
        a.index - b.index
    )
    .map((row) => row.user);
}
