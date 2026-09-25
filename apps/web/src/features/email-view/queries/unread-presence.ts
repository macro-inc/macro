import type { EntityData } from '@entity';
import type { SoupApiItem } from '@service-storage/generated/schemas';

/**
 * Membership of the Signal-unread set the Email unread dot stands for: the
 * scope `buildEmailQuery({ tab: 'important', facets: { read: ['unread'] } })`
 * asks the server for — the viewer's own thread, classified as Signal, still
 * in the inbox, still unread.
 *
 * A loaded page is not proof of membership on its own. Rows stay in it after
 * they are read or marked done, and websocket-driven cache operations prepend
 * rows the query itself would never return, so presence is decided per row.
 * A thread whose classification is missing (a row cached before `isSignal`
 * shipped, or one mapped from a preview that carries none) stays admitted:
 * hiding a genuinely unread thread is worse than counting a noisy one.
 */
export function emailEntityIsUnreadSignal(
  entity: EntityData,
  viewerId: string | undefined
): boolean {
  if (entity.type !== 'email') return false;
  if (entity.isRead || entity.done) return false;
  if (entity.isSignal === false) return false;
  return viewerId === undefined || entity.ownerId === viewerId;
}

/**
 * Item-level mirror of {@link emailEntityIsUnreadSignal}, used as the unread
 * query's `meta.insertFilter`. `insertSoupEntity` and
 * `restoreSoupEntityToDoneFilteredQueries` prepend into every soup query whose
 * gate accepts the item, and the unread page has no other defence: it is
 * mounted for the whole session, so anything admitted here stays until the
 * next fetch. Admission is all this decides — a miss delays an optimistic
 * insert, it cannot hide a row the server returned.
 */
export function soupItemIsUnreadSignal(
  item: SoupApiItem,
  viewerId: string | undefined
): boolean {
  if (item.tag !== 'emailThread') return false;
  const thread = item.data;
  return (
    thread.isSignal === true &&
    thread.isRead === false &&
    thread.inboxVisible === true &&
    (viewerId === undefined || thread.ownerId === viewerId)
  );
}
