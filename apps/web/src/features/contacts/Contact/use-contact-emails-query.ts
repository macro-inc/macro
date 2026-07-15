import { NIL_UUID } from '@app/features/next-soup/filters/filter-store';
import {
  andEmailFilters,
  emailFilterForAddress,
  emailFilterForSignal,
} from '@companies/Company/emailFilter';
import { useSoupAstItemsQuery } from '@queries/soup/items';
import type { Accessor } from 'solid-js';

export type EmailView = 'team' | 'me';
export type EmailSignalView = 'signal' | 'all';

/**
 * Email threads involving a single CRM contact, fetched via the
 * `/soup/ast` endpoint.
 *
 * - `team` (default): widens visibility to every teammate's mailbox via
 *   the CRM-scoped address filter (`eca`).
 * - `me`: drops `eca` and uses a raw `ef` any-direction OR-tree on the
 *   contact's address, so the default per-user mailbox scope applies and
 *   only the current user's own emails come back.
 * - `signal`: ANDs an Importance leaf into `ef` (the server AND-merges
 *   `ef` with the CRM scope tree, so it composes with `eca` too).
 */
export function useContactEmailsQuery(
  email: Accessor<string | undefined>,
  view: Accessor<EmailView>,
  signalView: Accessor<EmailSignalView>
) {
  return useSoupAstItemsQuery(
    () => {
      const addr = email();
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
              ef: andEmailFilters(
                addr ? emailFilterForAddress(addr) : undefined,
                signal
              ),
            }
          : { ...base, eca: addr ? [addr] : [], ef: signal };
      return {
        params: { limit: 100, sort_method: 'updated_at' },
        body,
      };
    },
    () => ({ enabled: !!email() })
  );
}
