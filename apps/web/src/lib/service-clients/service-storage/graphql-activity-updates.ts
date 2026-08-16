import { inspectVariants, selectAll } from '@graphql-cache/exchange/inspection';
import type { CacheHost } from '@graphql-cache/host/types';
import type { Client, OperationResult } from '@urql/core';
import {
  type ActivityUpdatesSubscription,
  EntityActivityDocument,
  type EntityActivityQuery,
  type EntityActivityQueryVariables,
  MyActivityDocument,
  type MyActivityQuery,
  type MyActivityQueryVariables,
} from './graphql/generated/graphql';

/** How long pushed events accumulate before one coalesced revalidation. */
export const ACTIVITY_PUSH_DEBOUNCE_MS = 300;

/**
 * Turns realtime activity pushes into query revalidations.
 *
 * A pushed `GraphqlActivityEvent` normalizes into its cache record through
 * the ordinary subscription write-through, but a brand-new id belongs to no
 * cached list yet — nothing references it, so no query re-emits. The cache
 * host has no push-side link-patch surface (link patches exist only inside
 * optimistic-mutation transactions), so list membership is recovered the
 * blunt-but-correct way: re-execute the canonical list queries against the
 * network. Pushes are per-subject and rare, and events are debounced into
 * one coalesced pass, so the network cost stays at "a page-0 fetch per burst
 * of your own actions".
 */
export function createActivityUpdatesHandler(context: {
  client: Pick<Client, 'query'>;
  host: CacheHost;
}): (result: OperationResult<ActivityUpdatesSubscription>) => void {
  const { client, host } = context;
  let pendingEntityIds = new Set<string>();
  let flushTimer: ReturnType<typeof setTimeout> | undefined;

  const flush = () => {
    flushTimer = undefined;
    const entityIds = pendingEntityIds;
    pendingEntityIds = new Set();
    void revalidateActivityQueries({ client, host, entityIds }).catch(
      (error) => {
        console.warn('activity push revalidation failed', error);
      }
    );
  };

  return (result) => {
    const patch = result.data?.activityUpdates;
    // Deletions need no list recovery: the write-through's cache deletion
    // already removes the record, and removals never add list members.
    if (patch?.__typename !== 'GraphqlActivityEvent') return;

    pendingEntityIds.add(patch.entityId);
    if (flushTimer === undefined) {
      flushTimer = setTimeout(flush, ACTIVITY_PUSH_DEBOUNCE_MS);
    }
  };
}

/**
 * Re-executes the activity list queries a pushed event may belong to: the
 * feed's first page, and the entity-activity preview of each pushed entity.
 * Only variants proven present in the cache are touched — an uncached
 * query has nothing stale to recover.
 */
async function revalidateActivityQueries(args: {
  client: Pick<Client, 'query'>;
  host: CacheHost;
  entityIds: ReadonlySet<string>;
}): Promise<void> {
  const { client, host, entityIds } = args;
  if (host.disabled) return;

  const refetches: Array<Promise<unknown>> = [];

  const feedVariants = await inspectVariants(
    host,
    selectAll(MyActivityDocument).field('user').field('activity')
  );
  for (const variant of feedVariants) {
    // Deeper pages are anchored strictly before their cursor, so a new
    // (newest) row can only ever belong to the first page.
    if (variant.variables.input.cursor != null) continue;
    refetches.push(
      client
        .query<MyActivityQuery, MyActivityQueryVariables>(
          MyActivityDocument,
          variant.variables,
          { requestPolicy: 'network-only' }
        )
        .toPromise()
    );
  }

  const entityVariants = await inspectVariants(
    host,
    selectAll(EntityActivityDocument).field('user').field('soup')
  );
  for (const variant of entityVariants) {
    if (!variantTargetsEntity(variant.variables, entityIds)) continue;
    refetches.push(
      client
        .query<EntityActivityQuery, EntityActivityQueryVariables>(
          EntityActivityDocument,
          variant.variables,
          { requestPolicy: 'network-only' }
        )
        .toPromise()
    );
  }

  await Promise.all(refetches);
}

/**
 * Whether a cached EntityActivity variant targets one of the pushed
 * entities. The variant's `input` is the exact-single-entity Soup filter
 * built by `buildEntityPropertiesInput`; rather than reconstructing that
 * AST per entity type, the check walks the variables for the entity id —
 * ids are UUIDs, so a false positive is negligible and costs only one
 * spurious preview refetch.
 */
function variantTargetsEntity(
  variables: EntityActivityQueryVariables,
  entityIds: ReadonlySet<string>
): boolean {
  let found = false;
  const visit = (value: unknown) => {
    if (found) return;
    if (typeof value === 'string') {
      if (entityIds.has(value)) found = true;
      return;
    }
    if (Array.isArray(value)) {
      for (const entry of value) visit(entry);
      return;
    }
    if (typeof value === 'object' && value !== null) {
      for (const entry of Object.values(value)) visit(entry);
    }
  };
  visit(variables.input);
  return found;
}
