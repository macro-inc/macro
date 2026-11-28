import { cacheSessionGeneration } from '@graphql-cache/session-generation';
import { refreshActiveGraphqlSoupQueries } from './active-queries';

/** Retry a failed post-write read while the write's session is current. */
export async function recoverActiveGraphqlSoupQueries(
  options: {
    where?: (body: unknown) => boolean;
    isPending?: () => boolean;
  } = {}
): Promise<boolean> {
  const generation = cacheSessionGeneration.capture();
  for (const delay of [0, 1000, 2000]) {
    if (delay > 0) await new Promise((resolve) => setTimeout(resolve, delay));
    if (
      !cacheSessionGeneration.isCurrent(generation) ||
      options.isPending?.() === false
    )
      return false;
    try {
      await refreshActiveGraphqlSoupQueries({
        throwOnError: true,
        ...(options.where ? { where: options.where } : {}),
      });
      return true;
    } catch {
      // Keep the committed write settled while affected readers recover.
    }
  }
  return false;
}
