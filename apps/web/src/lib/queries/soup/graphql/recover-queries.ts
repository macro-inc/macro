import { cacheSessionGeneration } from '@graphql-cache/session-generation';
import { Telemetry, type TraceContext } from '@macro-inc/observability';
import {
  type ActiveGraphqlSoupQuery,
  refreshActiveGraphqlSoupQueries,
} from './active-queries';

/** Retry a failed post-write read while the write's session is current. */
export async function recoverActiveGraphqlSoupQueries(
  options: {
    where?: (body: unknown) => boolean;
    isPending?: () => boolean;
    trace?: TraceContext;
  } = {}
): Promise<boolean> {
  const generation = cacheSessionGeneration.capture();
  const trace = options.trace ?? Telemetry.captureContext();
  const refreshed = new WeakMap<ActiveGraphqlSoupQuery, string>();
  for (const [attempt, delay] of [0, 1000, 2000].entries()) {
    if (delay > 0) await new Promise((resolve) => setTimeout(resolve, delay));
    if (
      !cacheSessionGeneration.isCurrent(generation) ||
      options.isPending?.() === false
    )
      return false;
    try {
      await trace.run(() =>
        Telemetry.span('soup.revalidation.recovery', async (span) => {
          span.setAttr('revalidation.attempt', attempt + 1);
          await refreshActiveGraphqlSoupQueries({
            refreshed,
            throwOnError: true,
            ...(options.where ? { where: options.where } : {}),
          });
        })
      );
      return true;
    } catch {
      // Keep the committed write settled while affected readers recover.
    }
  }
  return false;
}
