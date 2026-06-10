import { NIL_UUID } from '@app/component/next-soup/filters/filter-store';
import { emailFilterForAddress } from '@companies/Company/emailFilter';
import { useSoupAstItemsQuery } from '@queries/soup/items';
import type { Accessor } from 'solid-js';

export type EmailView = 'team' | 'me';

/**
 * Email threads involving a single CRM contact, fetched via the
 * `/soup/ast` endpoint.
 *
 * - `team` (default): widens visibility to every teammate's mailbox via
 *   the CRM-scoped address filter (`eca`).
 * - `me`: drops `eca` and uses a raw `ef` any-direction OR-tree on the
 *   contact's address, so the default per-user mailbox scope applies and
 *   only the current user's own emails come back.
 */
export function useContactEmailsQuery(
  email: Accessor<string | undefined>,
  view: Accessor<EmailView>
) {
  return useSoupAstItemsQuery(
    () => {
      const addr = email();
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
          ? {
              ...base,
              ef: addr ? emailFilterForAddress(addr) : undefined,
            }
          : { ...base, eca: addr ? [addr] : [] };
      return {
        params: { limit: 100, sort_method: 'updated_at' },
        body,
      };
    },
    () => ({ enabled: !!email() })
  );
}
