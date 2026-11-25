import { captureQueryAuthorization } from '@app/lib/urql-solid/authorization';
import { recordExternalWrite } from '@graphql-cache/exchange/external-writes';
import type { CacheHost } from '@graphql-cache/host/types';
import { captureCacheWriteSession } from '@graphql-cache/session-writes';
import { Telemetry } from '@macro-inc/observability';
import { getGraphqlSoupCacheHost } from './graphql-soup';

/** Requested companies and contacts merged into another, by lowercase id. */
export type MergedCrmRecords = {
  companies: readonly string[];
  contacts: readonly string[];
};

// A merged id never comes back, so each cache drops its record once; a
// preview naming it again would only refetch the queries the drop fences.
const DROPPED = new WeakMap<CacheHost, Set<string>>();

/**
 * Drops the cached records of companies and contacts merged into another.
 * The server no longer answers for a merged record's id, so its last cached
 * copy would keep naming company chips and listing the record in cached rows;
 * without it they read what the server answers now, the record that stays.
 * A removal carries no fetched content, so the cache host fences it with the
 * generation it has observed. On a page load that is not yet the owner's,
 * and the owner would refuse the removal as stale, so the owner is asked
 * first.
 */
export async function forgetMergedCrmRecords(
  merged: MergedCrmRecords
): Promise<void> {
  const host = getGraphqlSoupCacheHost();
  if (!host || host.disabled) return;
  const dropped = DROPPED.get(host) ?? new Set<string>();
  const keys = [
    ...merged.companies.map((id) => `GraphqlSoupCrmCompany:${id}`),
    ...merged.contacts.map((id) => `GraphqlSoupCrmContact:${id}`),
  ].filter((key) => !dropped.has(key));
  if (keys.length === 0) return;
  const typenames = [
    ...new Set(keys.map((key) => key.slice(0, key.indexOf(':')))),
  ];
  const canCache = captureQueryAuthorization();
  const session = captureCacheWriteSession();
  try {
    // Outside the session's write, so a sign-out never waits for the owner.
    await host.authority?.current();
  } catch (error) {
    Telemetry.error(error);
    return;
  }
  await session.run(async () => {
    if (
      host.disabled ||
      !canCache() ||
      !session.isCurrent() ||
      host !== getGraphqlSoupCacheHost()
    )
      return;
    recordExternalWrite(host, typenames);
    try {
      await host.deleteRecords(keys);
      for (const key of keys) dropped.add(key);
      DROPPED.set(host, dropped);
    } catch (error) {
      Telemetry.error(error);
    }
  });
}
