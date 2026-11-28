import { fireAndForget } from '@core/util/fireAndForget';
import { isTransientRequestError } from '@core/util/request-error';
import { catchToResult } from '@core/util/result';
import { cacheSessionGeneration } from '@graphql-cache/session-generation';
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
import { CombinedError } from '@urql/core';
import { match } from 'ts-pattern';
import {
  getUnmaintainedGraphqlSoupRevalidations,
  refreshActiveGraphqlSoupQueries,
} from '../soup/graphql/active-queries';
import { soupEntityKey } from '../soup/graphql/entity-input';
import {
  prepareGraphqlSoupRestore,
  soupOperationTime,
} from '../soup/graphql/optimistic-deletions';
import { soupItemKey } from '../soup/graphql/reconciliation';

type EntityWriteResult = {
  effectsResolved: boolean;
  listsReadAgain: boolean;
};

async function confirmListRefresh(read: Promise<void>): Promise<boolean> {
  try {
    await read;
    return true;
  } catch {
    return false;
  }
}

/** Reads again the lists a committed write left stale. Without a live cache
 * the client's exchange reads every mounted list before the write settles;
 * when it did, each successfully, nothing is read here, and when one of its
 * reads failed every list is read in its own cursor order. With a live cache
 * the write's returned rows update every list the cache keeps current, so only
 * the others are read. A write whose rows never came back leaves every list
 * stale. A failed read must not turn a committed write into a retryable
 * failure. */
function refreshAfterWrite(result: EntityWriteResult): void;
function refreshAfterWrite(
  result: EntityWriteResult,
  strict: true
): Promise<boolean>;
function refreshAfterWrite(result: EntityWriteResult, strict = false) {
  if (result.listsReadAgain) return strict ? Promise.resolve(true) : undefined;
  const unmaintainedOnly =
    result.effectsResolved && getGraphqlCacheHost() !== undefined;
  const refresh = refreshActiveGraphqlSoupQueries(
    strict ? { unmaintainedOnly, throwOnError: true } : { unmaintainedOnly }
  );
  if (strict) return confirmListRefresh(refresh);
  fireAndForget(refresh, 'entity-mutation');
}

export type OnSoupDeletion = (
  acknowledgement: Promise<boolean>,
  dispatchedAt: number
) => void;

async function deleteEntity(
  entity: EntityRefInput,
  write: typeof trashGraphqlEntity,
  onDeletion: OnSoupDeletion | undefined
) {
  const generation = cacheSessionGeneration.capture();
  const host = onDeletion ? getGraphqlCacheHost() : undefined;
  let result: Awaited<ReturnType<typeof write>>;
  const dispatchedAt = soupOperationTime();
  try {
    result = await write(entity);
  } catch (error) {
    if (
      host &&
      getGraphqlCacheHost() === host &&
      cacheSessionGeneration.isCurrent(generation) &&
      error instanceof CombinedError &&
      isTransientRequestError(error)
    ) {
      // The server may have trashed the item and its descendants before the
      // response was lost. Restore the failed overlay and read for recovery.
      refreshAfterWrite({ effectsResolved: false, listsReadAgain: false });
    }
    throw error;
  }
  if (!cacheSessionGeneration.isCurrent(generation)) {
    onDeletion?.(Promise.resolve(false), dispatchedAt);
    return;
  }
  if (!onDeletion) {
    refreshAfterWrite(result);
    return;
  }
  const key = soupEntityKey(entity);
  const hasTombstone =
    result.cacheEffectsApplied &&
    result.effects.some(
      (effect) =>
        effect.__typename === 'GraphqlCacheDeletion' &&
        `${effect.graphqlTypeName}:${effect.entityId}` === key
    );
  if (hasTombstone) {
    // Raw list snapshots gate release separately. A failed reread of an
    // unrelated unmaintained list must not veto this tombstone.
    refreshAfterWrite(result);
    onDeletion(Promise.resolve(true), dispatchedAt);
    return;
  }
  onDeletion(
    refreshAfterWrite({ ...result, effectsResolved: false }, true),
    dispatchedAt
  );
}

export async function moveEntity(
  entity: EntityRefInput,
  projectId: string | null
) {
  // A move the cache queued carries the lists to read once it commits. One
  // sent directly (no live cache, or the queue refused it) reads here, as
  // does one whose rows never came back.
  const result = await moveGraphqlEntity(
    { entity, projectId },
    getUnmaintainedGraphqlSoupRevalidations()
  );
  if (result.queued && result.effectsResolved) return;
  refreshAfterWrite(result);
}

export function trashEntity(
  entity: EntityRefInput,
  onDeletion?: OnSoupDeletion
) {
  return deleteEntity(entity, trashGraphqlEntity, onDeletion);
}

/** A restore can also update the enclosing folder. Only the target and its
 * restored subtree can supersede previous delete intents. */
function restoredEntityKeys(
  entity: EntityRefInput,
  effects: Awaited<ReturnType<typeof restoreGraphqlEntity>>['effects']
): string[] {
  const key = soupEntityKey(entity);
  if (!key) return [];
  if (entity.type !== 'PROJECT') return [key];

  const children = new Map<string, { key: string; projectId?: string }[]>();
  for (const effect of effects) {
    if (effect.__typename !== 'SoupUpdated') continue;
    const item = effect.item;
    let folderId: string | null | undefined;
    switch (item.__typename) {
      case 'GraphqlSoupProject':
        folderId = item.parentId;
        break;
      case 'GraphqlSoupDocument':
      case 'GraphqlSoupChat':
        folderId = item.projectId;
        break;
      default:
        continue;
    }
    if (!folderId || item.deletedAt) continue;
    const child = {
      key: soupItemKey(item),
      projectId: item.__typename === 'GraphqlSoupProject' ? item.id : undefined,
    };
    const siblings = children.get(folderId);
    if (siblings) siblings.push(child);
    else children.set(folderId, [child]);
  }

  const restored = new Set([key]);
  const projects = [String(entity.id)];
  for (const projectId of projects) {
    for (const child of children.get(projectId) ?? []) {
      if (restored.has(child.key)) continue;
      restored.add(child.key);
      if (child.projectId) projects.push(child.projectId);
    }
  }
  return [...restored];
}

export async function restoreEntity(entity: EntityRefInput) {
  const confirmRestore = prepareGraphqlSoupRestore();
  const result = await restoreGraphqlEntity(entity);
  confirmRestore(restoredEntityKeys(entity, result.effects));
  refreshAfterWrite(result);
}

export function permanentlyDeleteEntity(
  entity: EntityRefInput,
  onDeletion?: OnSoupDeletion
) {
  return deleteEntity(entity, permanentlyDeleteGraphqlEntity, onDeletion);
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
