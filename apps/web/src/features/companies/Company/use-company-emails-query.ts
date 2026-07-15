import { NIL_UUID } from '@app/features/next-soup/filters/filter-store';
import { useSoupAstItemsQuery } from '@queries/soup/items';
import type { Accessor } from 'solid-js';
import {
  andEmailFilters,
  emailFilterForDomains,
  emailFilterForSignal,
} from './emailFilter';

export type EmailView = 'team' | 'me';
export type EmailSignalView = 'signal' | 'all';

/**
 * Email threads the team has exchanged with a company, fetched via the
 * `/soup/ast` endpoint.
 *
 * - `team` (default): widens visibility to every teammate's mailbox via
 *   the CRM-scoped domain filter (`ecd`).
 * - `me`: drops `ecd` and uses a raw `ef` any-direction OR-tree across
 *   the company's domains, so the default per-user mailbox scope applies
 *   and only the current user's own emails come back.
 * - `signal`: ANDs an Importance leaf into `ef` (the server AND-merges
 *   `ef` with the CRM scope tree, so it composes with `ecd` too).
 */
export function useCompanyEmailsQuery(
  domains: Accessor<string[]>,
  view: Accessor<EmailView>,
  signalView: Accessor<EmailSignalView>
) {
  return useSoupAstItemsQuery(
    () => {
      const base = {
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
      const body =
        view() === 'me'
          ? {
              ...base,
              ef: andEmailFilters(emailFilterForDomains(domains()), signal),
            }
          : { ...base, ecd: domains(), ef: signal };
      return {
        params: { limit: 100, sort_method: 'updated_at' },
        body,
      };
    },
    () => ({ enabled: domains().length > 0 })
  );
}
