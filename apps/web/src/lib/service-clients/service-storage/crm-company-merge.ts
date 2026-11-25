import { captureQueryAuthorization } from '@app/lib/urql-solid/authorization';
import { recordExternalWrite } from '@graphql-cache/exchange/external-writes';
import { UNKNOWN_CACHE_GENERATION } from '@graphql-cache/generation-mirror';
import { captureCacheWriteSession } from '@graphql-cache/session-writes';
import { Telemetry } from '@macro-inc/observability';
import { getGraphqlSoupCacheHost } from './graphql-soup';

/**
 * Drops the cached records of companies merged into another. The server no
 * longer answers for a merged company's id, so its last cached title would
 * keep naming its chips; without it they read the REST preview, which names
 * the company that stays.
 */
export async function forgetMergedCrmCompanies(
  companyIds: readonly string[]
): Promise<void> {
  if (companyIds.length === 0) return;
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
    recordExternalWrite(host, ['GraphqlSoupCrmCompany']);
    try {
      await host.deleteRecords(
        companyIds.map((id) => `GraphqlSoupCrmCompany:${id}`),
        generation
      );
    } catch (error) {
      Telemetry.error(error);
    }
  });
}
