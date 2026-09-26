import type { SoupApiItem } from '@service-storage/generated/schemas';
import { match } from 'ts-pattern';
import type { HomeTab } from '../types';

/**
 * Item-level mirror of the Home tabs' server-side membership, used as the
 * Home query's `meta.insertFilter`. Websocket-driven cache operations
 * (`insertSoupEntity`, `restoreSoupEntityToDoneFilteredQueries`) prepend into
 * every matching soup query and only this filter tells them which tab an item
 * belongs to — without it a noise email lands in the Signal feed (and vice
 * versa) until an unrelated refetch corrects it. Emails are matched on the
 * server-computed `isSignal` carried by the soup payload; a row cached before
 * the field shipped matches neither tab and waits for the next fetch. The
 * server response is never filtered through this, so a miss can only delay an
 * optimistic insert, not hide a row.
 */
export function soupItemMatchesHomeTab(
  item: SoupApiItem,
  tab: HomeTab
): boolean {
  return match(tab)
    .with(
      'signal',
      () => item.tag !== 'emailThread' || item.data.isSignal === true
    )
    .with(
      'noise',
      () => item.tag === 'emailThread' && item.data.isSignal === false
    )
    .with('reminders', () => item.tag === 'reminder')
    .exhaustive();
}
