import { fireAndForget } from '@core/util/fireAndForget';
import { catchToResult } from '@core/util/result';
import type { AccessLevel } from '@service-storage/generated/schemas/accessLevel';
import type { UpdateSharePermissionRequestV2 } from '@service-storage/generated/schemas/updateSharePermissionRequestV2';
import type {
  EntityRefInput,
  EntitySharePolicyInput,
  GraphqlEntityAccessLevel,
  GraphqlSharePolicyOperation,
} from '@service-storage/graphql/generated/graphql';
import {
  duplicateGraphqlEntity,
  moveGraphqlEntity,
  permanentlyDeleteGraphqlEntity,
  restoreGraphqlEntity,
  trashGraphqlEntity,
  updateGraphqlEntitySharePolicy,
} from '@service-storage/graphql-entity-mutations';
import { getGraphqlCacheHost } from '@service-storage/graphql-soup';
import { match } from 'ts-pattern';
import {
  getUnmaintainedGraphqlSoupRevalidations,
  refreshActiveGraphqlSoupQueries,
} from '../soup/graphql/active-queries';
import { soupEntityKey } from '../soup/graphql/entity-input';
import { prepareGraphqlSoupRestore } from '../soup/graphql/optimistic-deletions';
import { soupItemKey } from '../soup/graphql/reconciliation';

/** Reads again the lists a committed write left stale. Without a live cache
 * the client's exchange reads every mounted list before the write settles;
 * when it did, each successfully, nothing is read here, and when one of its
 * reads failed every list is read in its own cursor order. With a live cache
 * the write's returned rows update every list the cache keeps current, so only
 * the others are read. A write whose rows never came back leaves every list
 * stale. A failed read must not turn a committed write into a retryable
 * failure. */
function refreshAfterWrite(result: {
  effectsResolved: boolean;
  listsReadAgain: boolean;
}) {
  if (result.listsReadAgain) return;
  const unmaintainedOnly =
    result.effectsResolved && getGraphqlCacheHost() !== undefined;
  fireAndForget(
    refreshActiveGraphqlSoupQueries({ unmaintainedOnly }),
    'entity-mutation'
  );
}

export async function moveEntity(
  entity: EntityRefInput,
  projectId: string | null
) {
  // With a live cache a move is queued with the lists to read once it
  // commits, so only one whose rows never came back reads them here.
  const result = await moveGraphqlEntity(
    { entity, projectId },
    getUnmaintainedGraphqlSoupRevalidations()
  );
  if (getGraphqlCacheHost() && result.effectsResolved) return;
  refreshAfterWrite(result);
}

export async function trashEntity(entity: EntityRefInput) {
  refreshAfterWrite(await trashGraphqlEntity(entity));
}

export async function restoreEntity(entity: EntityRefInput) {
  const confirmRestore = prepareGraphqlSoupRestore();
  const result = await restoreGraphqlEntity(entity);
  const restoredKey = soupEntityKey(entity);
  confirmRestore([
    ...(restoredKey ? [restoredKey] : []),
    ...result.effects.flatMap((effect) =>
      effect.__typename === 'SoupUpdated' ? [soupItemKey(effect.item)] : []
    ),
  ]);
  refreshAfterWrite(result);
}

export async function permanentlyDeleteEntity(entity: EntityRefInput) {
  refreshAfterWrite(await permanentlyDeleteGraphqlEntity(entity));
}

export async function duplicateEntity(
  entity: EntityRefInput,
  displayName?: string
): Promise<string> {
  const result = await duplicateGraphqlEntity({ entity, displayName });
  refreshAfterWrite(result);
  for (const effect of result.effects) {
    if (effect.__typename !== 'SoupUpdated' || effect.item.id === entity.id)
      continue;
    if (
      (entity.type === 'DOCUMENT' &&
        effect.item.__typename === 'GraphqlSoupDocument') ||
      (entity.type === 'CHAT' &&
        effect.item.__typename === 'GraphqlSoupChat') ||
      (entity.type === 'PROJECT' &&
        effect.item.__typename === 'GraphqlSoupProject')
    )
      return effect.item.id;
  }
  throw new Error(
    'Duplication succeeded but returned no copy identity; do not retry automatically'
  );
}

function shareEntityType(itemType: string) {
  return match(itemType)
    .with('document', () => 'DOCUMENT' as const)
    .with('project', () => 'PROJECT' as const)
    .with('chat', () => 'CHAT' as const)
    .with('email', () => 'EMAIL_THREAD' as const)
    .with('call', () => 'CALL' as const)
    .otherwise(() => undefined);
}

export function usesGraphqlSharePolicy(itemType: string): boolean {
  return shareEntityType(itemType) !== undefined;
}

const ACCESS_LEVELS: Record<AccessLevel, GraphqlEntityAccessLevel> = {
  view: 'VIEW',
  comment: 'COMMENT',
  edit: 'EDIT',
  owner: 'OWNER',
};
const SHARE_OPERATIONS: Record<
  'add' | 'remove' | 'replace',
  GraphqlSharePolicyOperation
> = {
  add: 'ADD',
  remove: 'REMOVE',
  replace: 'REPLACE',
};

/** Preserve omission versus explicit null: null revokes, omission leaves unchanged. */
function sharePolicy(
  request: UpdateSharePermissionRequestV2
): EntitySharePolicyInput {
  const level = (value: AccessLevel | null | undefined) =>
    value == null ? value : ACCESS_LEVELS[value];
  return {
    linkShare: request.linkShare,
    linkShareAccessLevel: level(request.linkShareAccessLevel),
    teamShareAccessLevel: level(request.teamShareAccessLevel),
    channelSharePermissions: request.channelSharePermissions?.map((entry) => ({
      channelId: entry.channelId,
      operation: SHARE_OPERATIONS[entry.operation],
      accessLevel: level(entry.accessLevel),
    })),
  };
}

export function updateEntitySharePolicy(
  itemType: string,
  id: string,
  request: UpdateSharePermissionRequestV2
) {
  return catchToResult(async () => {
    const type = shareEntityType(itemType);
    if (!type) throw new Error(`Unsupported GraphQL share policy: ${itemType}`);
    refreshAfterWrite(
      await updateGraphqlEntitySharePolicy({
        entity: { type, id },
        policy: sharePolicy(request),
      })
    );
  });
}
