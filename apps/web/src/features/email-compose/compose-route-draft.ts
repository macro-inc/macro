import { createSearchParams } from '@app/lib/split-router';
import { z } from 'zod';

export const composeDraftSearch = {
  namespace: 'email-compose',
  schema: z.object({ draft: z.string() }),
  defaults: { draft: '' },
};

/** The compose route's draft, kept in its URL so a reload reopens it. */
export function createComposeRouteDraft() {
  const [search, setSearch] = createSearchParams(composeDraftSearch);
  return {
    draftId: () => search.draft || undefined,
    record(draftId: string | undefined) {
      if ((draftId ?? '') === search.draft) return;
      setSearch({ draft: draftId }, { history: 'replace' });
    },
  };
}
