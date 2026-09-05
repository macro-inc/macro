import type { SoupApiItem } from '@service-storage/generated/schemas';
import { match } from 'ts-pattern';
import { emailItemLooksSignal } from '../../next-soup/filters/email-signal';
import type { InboxTab } from '../types';

/**
 * Item-level mirror of the inbox tabs' server-side membership, used as the
 * inbox query's `meta.insertFilter`. Websocket-driven cache operations
 * (`insertSoupEntity`, `restoreSoupEntityToDoneFilteredQueries`) prepend into
 * every matching soup query and only this gate tells them which tab an item
 * belongs to — without it a noise email lands in the Signal feed (and vice
 * versa) until an unrelated refetch corrects it. Fetched rows never run
 * through this, and the email heuristic is an approximation (see
 * `emailItemLooksSignal`) — a misclassification keeps a websocket insert or
 * restore out of the feed until the next server fetch.
 */
export function soupItemMatchesInboxTab(
  item: SoupApiItem,
  tab: InboxTab
): boolean {
  return match(tab)
    .with(
      'signal',
      () => item.tag !== 'emailThread' || emailItemLooksSignal(item.data)
    )
    .with(
      'noise',
      () => item.tag === 'emailThread' && !emailItemLooksSignal(item.data)
    )
    .with('all', () => true)
    .with('reminders', () => item.tag === 'reminder')
    .exhaustive();
}
