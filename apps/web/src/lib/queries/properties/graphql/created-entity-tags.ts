import { TRACE_PARENT_CONTEXT_KEY } from '@app/lib/urql-solid/trace-parent-exchange';
import { networkRevalidated } from '@graphql-cache/exchange/network-revalidation-exchange';
import { normalizedCacheResultMetadata } from '@graphql-cache/exchange/normalized-cache-exchange';
import {
  optimisticMutationContext,
  optimisticMutationDispositionOf,
} from '@graphql-cache/exchange/optimistic';
import { cacheSessionGeneration } from '@graphql-cache/session-generation';
import { Telemetry } from '@macro-inc/observability';
import { invalidateSoupEntity } from '@queries/soup/cache';
import { getUnmaintainedGraphqlSoupRevalidations } from '@queries/soup/graphql/active-queries';
import { refreshAfterWrite } from '@queries/soup/graphql/refresh-after-write';
import {
  type UpdateEntityPropertyOptionsInput,
  UpdateSoupEntityPropertyOptionsDocument,
} from '@service-storage/graphql/generated/graphql';
import {
  getGraphqlCacheHost,
  getGraphqlSoupClient,
} from '@service-storage/graphql-soup';

type CreatedEntityTagsInput = UpdateEntityPropertyOptionsInput & {
  entityType: 'DOCUMENT' | 'PROJECT';
};

/** The parent's returned row admits it to a filtered list even if the cache has
 * never seen it. The queue preserves the option additions and list descriptors. */
export async function saveCreatedEntityTags(input: CreatedEntityTagsInput) {
  const generation = cacheSessionGeneration.capture();
  await Telemetry.span('entity.set_creation_tags', async (span) => {
    span.setAttr('entity.id', input.entityId);
    span.setAttr('entity.type', input.entityType);
    const client = getGraphqlSoupClient();
    const result = await client
      .mutation(
        UpdateSoupEntityPropertyOptionsDocument,
        { input },
        {
          [TRACE_PARENT_CONTEXT_KEY]: span,
          ...optimisticMutationContext(
            {},
            {
              uuid: crypto.randomUUID(),
              authorizationEpoch: generation,
              revalidations: getGraphqlCacheHost()
                ? getUnmaintainedGraphqlSoupRevalidations()
                : undefined,
            }
          ),
        }
      )
      .toPromise();

    if (!cacheSessionGeneration.isCurrent(generation)) return;

    const disposition = optimisticMutationDispositionOf(result);
    if (disposition?.kind === 'queued') return;
    if (result.error) throw result.error;

    const payload = result.data?.updateSoupEntityPropertyOptions;
    if (!payload) throw new Error('The tag update returned no result');
    const metadata = normalizedCacheResultMetadata(result);
    const cacheRejected =
      metadata?.source === 'live-network' &&
      metadata.cacheEffectsApplied === false;
    // A durable commit owns its recorded revalidations. When no queue took
    // the write, apply the same recovery as the other direct entity mutations.
    if (
      !payload.effect ||
      metadata?.source === 'live-network' ||
      !disposition
    ) {
      refreshAfterWrite({
        effectsResolved:
          payload.effect?.__typename === 'SoupUpdated' && !cacheRejected,
        listsReadAgain: networkRevalidated(result),
      });
    }

    // The legacy REST list cache is independent of the normalized GraphQL row.
    invalidateSoupEntity(input.entityId);
  });
}
