import type { CacheHost } from '@graphql-cache/host/types';
import { SoupSharedMailBackfillDocument } from './graphql/generated/graphql';
import {
  type FetchGraphqlSoupOptions,
  type GraphqlSoupHydrationPage,
  type GraphqlSoupInput,
  getGraphqlSoupCacheHost,
  hydrateGraphqlSoup,
} from './graphql-soup';

const identityQuery = 'query SharedMailIdentity { user { id } }';
type IdentityData = { user: { id: string } };
const nil = '00000000-0000-0000-0000-000000000000';
const filters = {
  documentFilter: { literal: { id: nil } },
  projectFilter: { literal: { projectIdSelf: nil } },
  chatFilter: { literal: { chatId: nil } },
  calendarEventFilter: { literal: { id: nil } },
  channelFilter: { literal: { channelId: nil } },
  channelThreadFilter: { literal: { threadId: nil } },
  callFilter: { literal: { callId: nil } },
  crmCompanyFilter: { literal: { id: nil } },
  foreignEntityFilter: { literal: { id: nil } },
  emailFilter: { tree: { literal: { shared: 'ONLY' } } },
};
type FetchPage = (
  input: GraphqlSoupInput,
  options?: Pick<FetchGraphqlSoupOptions, 'signal'>
) => Promise<GraphqlSoupHydrationPage>;

/** Capture previous Shared membership at one cache revision. Unknown or another
 * viewer's catalog is not evidence; never infer a deletion from it. */
async function previousMembership(
  host: CacheHost | undefined,
  userId: string
): Promise<Set<string>> {
  if (!host || host.disabled) return new Set();
  const user = await host.readQuery({ query: identityQuery });
  if (user.kind !== 'hit' || (user.data as IdentityData).user.id !== userId)
    return new Set();
  const keys = new Set<string>();
  let cursor: string | undefined;
  do {
    const page = await host.entityFilter({
      filters,
      sortMethod: 'UPDATED_AT',
      sortDirection: 'DESC',
      limit: 499,
      mail: { view: 'ALL', cursor },
    });
    // A stale continuation makes the whole snapshot unusable for revocations,
    // but must not prevent the fresh network scan from hydrating shared mail.
    if (page.kind !== 'mail-page') return new Set();
    for (const key of page.keys) keys.add(key);
    cursor = page.nextCursor ?? undefined;
  } while (cursor);
  return keys;
}

/** A fresh, full, successful Shared scan revokes old projection proof for rows
 * no longer returned. Failure/cancellation never clears cached access evidence.
 * Invalidating (not deleting) is conservative when rows move during the scan. */
export async function createSharedMailBackfillFetcher(
  userId: string,
  host = getGraphqlSoupCacheHost(),
  fetch: FetchPage = (input, options) =>
    hydrateGraphqlSoup(SoupSharedMailBackfillDocument, { input }, options)
): Promise<FetchPage> {
  const previous = await previousMembership(host, userId);
  const seen = new Set<string>();
  let completeEvidence = true;
  return async (input, options) => {
    const page = await fetch(input, options);
    if (options?.signal?.aborted) throw new Error('Shared Mail scan cancelled');
    if (!page.entityIds) completeEvidence = false;
    for (const id of page.entityIds ?? [])
      seen.add(`GraphqlSoupEmailThread:${id}`);
    if (page.nextCursor === null && completeEvidence && host && previous.size) {
      const viewer = await host.readQuery({ query: identityQuery });
      if (
        viewer.kind === 'hit' &&
        (viewer.data as IdentityData).user.id === userId
      ) {
        const missing = [...previous].filter((key) => !seen.has(key));
        for (let offset = 0; offset < missing.length; offset += 500) {
          if (options?.signal?.aborted)
            throw new Error('Shared Mail scan cancelled');
          await host.invalidate(missing.slice(offset, offset + 500));
        }
      }
    }
    return page;
  };
}
