import { NIL_UUID } from '@app/features/next-soup/filters/filter-store';
import type { useSoupAstItemsQuery } from '@queries/soup/items';
import type { Accessor } from 'solid-js';
import { andEmailFilters, emailFilterForSignal } from './email-filter';

export type EmailView = 'team' | 'me';
export type EmailSignalView = 'signal' | 'all';

/**
 * Email threads the team has exchanged with a company, fetched via the
 * `/soup/ast` endpoint.
 *
 * - `team` (default): widens visibility to every teammate's mailbox via
 *   the CRM-scoped domain filter (`ecd`).
 * - `me`: retains CRM consent/exclusions and narrows to the caller's mailbox.
 * - `signal`: ANDs an Importance leaf into `ef` (the server AND-merges
 *   `ef` with the CRM scope tree, so it composes with `ecd` too).
 */
export function useCompanyEmailsQuery(
  createQuery: typeof useSoupAstItemsQuery,
  domains: Accessor<string[]>,
  view: Accessor<EmailView>,
  signalView: Accessor<EmailSignalView>,
  primaryLinkId: Accessor<string | undefined>
) {
  return createQuery(
    () => {
      const base = {
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
      };
      const signal =
        signalView() === 'signal' ? emailFilterForSignal() : undefined;
      const body = {
        ...base,
        ecd: domains(),
        ef: andEmailFilters(
          signal,
          view() === 'me'
            ? { l: { Owner: primaryLinkId() ?? NIL_UUID } }
            : undefined
        ),
      };
      return {
        params: { limit: 100, sort_method: 'updated_at' },
        body,
      };
    },
    () => ({
      enabled: domains().length > 0 && (view() !== 'me' || !!primaryLinkId()),
    })
  );
}
