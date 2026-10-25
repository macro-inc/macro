import {
  enableGraphqlSoup,
  isFeatureEnabled,
} from '@core/constant/featureFlags';
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
import { match } from 'ts-pattern';
import { refreshActiveGraphqlSoupQueries } from '../soup/graphql/active-queries';
import { prepareGraphqlSoupRestore } from '../soup/graphql/optimistic-deletions';

// Membership changes need a refresh even when the normalized cache is disabled.
// A failed refresh must not turn a committed write into a retryable UI failure.
function refreshSoup() {
  fireAndForget(refreshActiveGraphqlSoupQueries(), 'entity-mutation');
}

export async function moveEntity(
  entity: EntityRefInput,
  projectId: string | null
) {
  await moveGraphqlEntity({ entity, projectId });
  refreshSoup();
}

export async function trashEntity(entity: EntityRefInput) {
  await trashGraphqlEntity(entity);
  refreshSoup();
}

export async function restoreEntity(entity: EntityRefInput) {
  const confirmRestore = prepareGraphqlSoupRestore();
  const result = await restoreGraphqlEntity(entity);
  confirmRestore([
    String(entity.id),
    ...result.effects.flatMap((effect) =>
      effect.__typename === 'SoupUpdated' ? [effect.item.id] : []
    ),
  ]);
  refreshSoup();
}

export async function permanentlyDeleteEntity(entity: EntityRefInput) {
  await permanentlyDeleteGraphqlEntity(entity);
  refreshSoup();
}

export async function duplicateEntity(
  entity: EntityRefInput,
  displayName?: string
): Promise<string> {
  const result = await duplicateGraphqlEntity({ entity, displayName });
  refreshSoup();
  for (const effect of result.effects) {
    if (effect.__typename !== 'SoupUpdated' || effect.item.id === entity.id)
      continue;
    if (
      (entity.type === 'DOCUMENT' &&
        effect.item.__typename === 'GraphqlSoupDocument') ||
      (entity.type === 'CHAT' && effect.item.__typename === 'GraphqlSoupChat')
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
  return (
    isFeatureEnabled(enableGraphqlSoup) &&
    shareEntityType(itemType) !== undefined
  );
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
    await updateGraphqlEntitySharePolicy({
      entity: { type, id },
      policy: sharePolicy(request),
    });
    refreshSoup();
  });
}
