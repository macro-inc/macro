import { NIL_UUID } from '@app/features/next-soup/filters/filter-store';
import { emailFilterForAddresses } from '@companies/Company/emailFilter';
import { useSoupAstItemsQuery } from '@queries/soup/items';
import type { Accessor } from 'solid-js';

/** How many threads the Correspondence section loads. */
export const CORRESPONDENCE_THREAD_LIMIT = 50;

/**
 * The most recent email threads shared with `addresses`, newest first.
 *
 * Uses the raw `ef` any-direction OR-tree rather than the CRM-scoped `ecd`
 * widener, so the query stays inside the caller's own mailbox scope and works
 * whether or not the team has CRM enabled for these correspondents. Every
 * non-email soup source is switched off with the NIL-UUID sentinel — the same
 * set `useCompanyEmailsQuery` disables, calendar (`calf`) included, so an
 * event with the same participants can't surface among the threads.
 *
 * A single page of {@link CORRESPONDENCE_THREAD_LIMIT} is all the section
 * shows — it scrolls rather than paginating.
 */
export function useCorrespondenceThreadsQuery(addresses: Accessor<string[]>) {
  return useSoupAstItemsQuery(
    () => ({
      params: {
        limit: CORRESPONDENCE_THREAD_LIMIT,
        sort_method: 'updated_at',
      },
      body: {
        calf: { l: { id: NIL_UUID } },
        df: { l: { id: NIL_UUID } },
        chanf: { l: { ChannelId: NIL_UUID } },
        cthf: { l: { ThreadId: NIL_UUID } },
        cf: { l: { cid: NIL_UUID } },
        pf: { l: { pid: NIL_UUID } },
        callf: { l: { CallId: NIL_UUID } },
        ccf: { l: { id: NIL_UUID } },
        fef: { l: { id: NIL_UUID } },
        emailView: 'all',
        ef: emailFilterForAddresses(addresses()),
      },
    }),
    () => ({ enabled: addresses().length > 0 })
  );
}
