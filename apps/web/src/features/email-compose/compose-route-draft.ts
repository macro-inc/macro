import { createSearchParams } from '@app/lib/split-router';
import { z } from 'zod';
import { recipientsFromLink } from './compose-params';

export const composeDraftSearch = {
  namespace: 'email-compose',
  // `to` holds the recipients a `?to=` link opened the composer with; a link
  // can repeat it.
  schema: z.object({ draft: z.string(), to: z.array(z.string()) }),
  defaults: { draft: '', to: [] as string[] },
};

/** The compose route's draft, kept in its URL so a reload reopens it. */
export function createComposeRouteDraft() {
  const [search, setSearch] = createSearchParams(composeDraftSearch);
  return {
    draftId: () => search.draft || undefined,
    linkedRecipients: () => recipientsFromLink(search.to.join(',')),
    record(draftId: string | undefined) {
      if ((draftId ?? '') === search.draft) return;
      setSearch({ draft: draftId }, { history: 'replace' });
    },
  };
}
