import { captureQueryAuthorization } from '@app/lib/urql-solid/authorization';
import { recordExternalWrite } from '@graphql-cache/exchange/external-writes';
import { UNKNOWN_CACHE_GENERATION } from '@graphql-cache/generation-mirror';
import { captureCacheWriteSession } from '@graphql-cache/session-writes';
import { Telemetry } from '@macro-inc/observability';
import { getGraphqlSoupCacheHost } from './graphql-soup';

/** Requested companies and contacts merged into another, by lowercase id. */
export type MergedCrmRecords = {
  companies: readonly string[];
  contacts: readonly string[];
};

/**
 * Drops the cached records of companies and contacts merged into another.
 * The server no longer answers for a merged record's id, so its last cached
 * copy would keep naming its chips and rows; without it they read the REST
 * preview, which names the record that stays.
 */
export async function forgetMergedCrmRecords(
  merged: MergedCrmRecords
): Promise<void> {
  const keys = [
    ...merged.companies.map((id) => `GraphqlSoupCrmCompany:${id}`),
    ...merged.contacts.map((id) => `GraphqlSoupCrmContact:${id}`),
  ];
  if (keys.length === 0) return;
  const typenames = [
    ...(merged.companies.length > 0 ? ['GraphqlSoupCrmCompany'] : []),
    ...(merged.contacts.length > 0 ? ['GraphqlSoupCrmContact'] : []),
  ];
  const canCache = captureQueryAuthorization();
  const session = captureCacheWriteSession();
  const host = getGraphqlSoupCacheHost();
  const generation =
    host?.authority?.snapshot()?.generation ?? UNKNOWN_CACHE_GENERATION;
  await session.run(async () => {
    if (
      !host ||
      host.disabled ||
      !canCache() ||
      !session.isCurrent() ||
      host !== getGraphqlSoupCacheHost()
    )
      return;
    recordExternalWrite(host, typenames);
    try {
      await host.deleteRecords(keys, generation);
    } catch (error) {
      Telemetry.error(error);
    }
  });
}
