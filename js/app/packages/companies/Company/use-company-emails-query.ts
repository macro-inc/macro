import { NIL_UUID } from '@app/component/next-soup/filters/filter-store';
import { useSoupAstItemsQuery } from '@queries/soup/items';
import type { Accessor } from 'solid-js';
import { emailFilterForDomains } from './emailFilter';

export type EmailView = 'team' | 'me';

/**
 * Email threads the team has exchanged with a company, fetched via the
 * `/soup/ast` endpoint.
 *
 * - `team` (default): widens visibility to every teammate's mailbox via
 *   the CRM-scoped domain filter (`ecd`).
 * - `me`: drops `ecd` and uses a raw `ef` any-direction OR-tree across
 *   the company's domains, so the default per-user mailbox scope applies
 *   and only the current user's own emails come back.
 */
export function useCompanyEmailsQuery(
  domains: Accessor<string[]>,
  view: Accessor<EmailView>
) {
  return useSoupAstItemsQuery(
    () => {
      const base = {
        df: { l: { id: NIL_UUID } },
        chanf: { l: { ChannelId: NIL_UUID } },
        cf: { l: { cid: NIL_UUID } },
        pf: { l: { pid: NIL_UUID } },
        callf: { l: { CallId: NIL_UUID } },
        ccf: { l: { id: NIL_UUID } },
        fef: { l: { id: NIL_UUID } },
        emailView: 'all',
      };
      const body =
        view() === 'me'
          ? { ...base, ef: emailFilterForDomains(domains()) }
          : { ...base, ecd: domains() };
      return {
        params: { limit: 100, sort_method: 'updated_at' },
        body,
      };
    },
    () => ({ enabled: domains().length > 0 })
  );
}
