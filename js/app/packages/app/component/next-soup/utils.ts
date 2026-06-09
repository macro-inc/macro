import type { SplitHandle } from '@app/component/split-layout/layoutManager';
import { globalSplitManager } from '@app/signal/splitLayout';
import { URL_PARAMS as CALL_PARAMS } from '@block-call/constants';
import { URL_PARAMS as CHANNEL_PARAMS } from '@block-channel/constants';
import { getChannelParams } from '@block-channel/utils/link';
import { URL_PARAMS as EMAIL_PARAMS } from '@block-email/constants';
import { URL_PARAMS as MD_PARAMS } from '@block-md/constants';
import { URL_PARAMS as PDF_PARAMS } from '@block-pdf/signal/location';
import { fileTypeToBlockName } from '@core/constant/allBlocks';
import {
  ENTITY_ID_DATA_ATTRIBUTE,
  entityIdSelector,
} from '@core/dom-selectors';
import type { BlockOrchestrator } from '@core/orchestrator';
import type { DateValue } from '@core/util/date';
import { throwOnErr } from '@core/util/result';
import { waitForFrames } from '@core/util/sleep';
import { openExternalUrl } from '@core/util/url';
import {
  type EntityData,
  getSnippetHit,
  isGithubPrEntity,
  isSearchEntity,
  isSnippetEntity,
  type SearchLocation,
  toNotificationEntity,
  type WithSearch,
} from '@entity';
import { queryKeys } from '@macro-entity';
import {
  compositeEntity,
  type NotificationSource,
  setDoneOverride,
} from '@notifications';
import { queryClient } from '@queries/client';
import { emailKeys } from '@queries/email/keys';
import { notificationKeys } from '@queries/notification/keys';
import {
  bulkMarkNotificationsAsDone,
  bulkMarkNotificationsAsUndone,
  restoreUserNotifications,
  snapshotUserNotifications,
} from '@queries/notification/user-notifications';
import {
  getSoupEntityById,
  invalidateSoupEntity,
  optimisticUpdateSoupEntity,
  removeSoupEntities,
} from '@queries/soup/cache';
import { emailClient } from '@service-email/client';
import { isAfter } from 'date-fns';
import { match } from 'ts-pattern';

const mergeSearchEntities = <T extends EntityData>(
  first: WithSearch<T>,
  second: WithSearch<T>
): WithSearch<T> => {
  const serviceEntity = first.search.source === 'service' ? first : second;
  const localEntity = first.search.source === 'local' ? first : second;
  const hasLocal =
    first.search.source === 'local' || second.search.source === 'local';

  // NOTE: we that the longer name highlight is more relevant since it will contain a macro highlight tag
  let nameHighlight;
  if (serviceEntity.search.nameHighlight && localEntity.search.nameHighlight) {
    nameHighlight =
      serviceEntity.search.nameHighlight.length >=
      localEntity.search.nameHighlight.length
        ? serviceEntity.search.nameHighlight
        : localEntity.search.nameHighlight;
  } else {
    nameHighlight =
      serviceEntity.search.nameHighlight || localEntity.search.nameHighlight;
  }

  return {
    ...localEntity,
    ...serviceEntity,
    search: {
      ...serviceEntity.search,
      source: hasLocal ? 'local' : 'service',
      nameHighlight,
      contentHitData: serviceEntity.search.contentHitData?.length
        ? serviceEntity.search.contentHitData
        : localEntity.search.contentHitData,
    },
  };
};

/**
 * Deduplicates entities by id, preferring entities with search data from 'service' source
 * over 'local' source, and using latest timestamp as a tiebreaker.
 * When preferring service results, merges local nameHighlight if service doesn't have one.
 */
export const deduplicateEntities = <T extends EntityData>(
  entities: T[]
): T[] => {
  const entityMap = new Map<string, T>();

  for (const entity of entities) {
    const existing = entityMap.get(entity.id);

    if (!existing) {
      entityMap.set(entity.id, entity);
      continue;
    }

    const existingHasSearch = isSearchEntity(existing);
    const newHasSearch = isSearchEntity(entity);

    // Prefer entities with search data
    if (newHasSearch && !existingHasSearch) {
      entityMap.set(entity.id, entity);
      continue;
    }

    // If both have search data, prefer 'service' over 'local'
    if (existingHasSearch && newHasSearch) {
      const existingSource = existing.search.source;
      const newSource = entity.search.source;

      if (
        (newSource === 'service' && existingSource === 'local') ||
        (existingSource === 'service' && newSource === 'local')
      ) {
        // Merge service and local search data
        entityMap.set(entity.id, mergeSearchEntities(entity, existing));
        continue;
      }

      // If both are the same source, keep the one with latest timestamp
      if (isNewerEntity(entity, existing)) {
        entityMap.set(entity.id, entity);
      }
      continue;
    }

    // If neither has search, keep the one with latest timestamp
    if (!existingHasSearch && !newHasSearch) {
      if (isNewerEntity(entity, existing)) {
        entityMap.set(entity.id, entity);
      }
    }
    // Otherwise keep existing (it has search and new doesn't)
  }

  return Array.from(entityMap.values());
};

/**
 * Gets the timestamp of an entity (updatedAt or createdAt)
 */
const getEntityTimestamp = (entity: EntityData): DateValue => {
  return entity.updatedAt ?? entity.createdAt ?? new Date(0);
};

/**
 * Returns true if the new entity should replace the existing one based on timestamp. If the timestamp is the same, prefer to use the newer entity to handle optimistic updates
 */
const isNewerEntity = (
  newEntity: EntityData,
  existing: EntityData
): boolean => {
  return isAfter(getEntityTimestamp(newEntity), getEntityTimestamp(existing));
};

export const openEntityInNewTab = ({
  entity,
  location,
}: {
  entity: EntityData;
  location?: SearchLocation;
}) => {
  // Build URL for the entity
  let entityPath: string;
  if (entity.type === 'document') {
    const { fileType, subType } = entity;
    const blockName = fileTypeToBlockName(subType?.type ?? fileType);
    entityPath = `/app/${blockName}/${entity.id}`;
  } else if (entity.type === 'channel_message') {
    entityPath = `/app/channel/${entity.channelId}`;
  } else {
    entityPath = `/app/${entity.type}/${entity.id}`;
  }

  // Add location params if present
  let entityUrl = new URL(entityPath, window.location.origin);

  if (entity.type === 'channel_message') {
    entityUrl.searchParams.set(CHANNEL_PARAMS.message, entity.messageId);
    if (entity.threadId) {
      entityUrl.searchParams.set(CHANNEL_PARAMS.thread, entity.threadId);
    }
  } else if (location) {
    switch (location.type) {
      case 'channel':
        if (location.messageId) {
          entityUrl.searchParams.set(
            CHANNEL_PARAMS.message,
            location.messageId
          );
        }
        if (location.threadId) {
          entityUrl.searchParams.set(CHANNEL_PARAMS.thread, location.threadId);
        }
        break;
      case 'email':
        if (location.messageId) {
          entityUrl.searchParams.set('email_message_id', location.messageId);
        }

        break;
      case 'md':
        if (location.nodeId) {
          entityUrl.searchParams.set('node_id', location.nodeId);
        }
        break;
      case 'pdf':
        if (location.searchPage !== undefined) {
          entityUrl.searchParams.set(
            'search_page',
            location.searchPage.toString()
          );
        }
        if (location.searchRawQuery) {
          entityUrl.searchParams.set(
            'search_raw_query',
            location.searchRawQuery
          );
        }
        if (location.highlightTerms) {
          entityUrl.searchParams.set(
            'search_highlight_terms',
            JSON.stringify(location.highlightTerms)
          );
        }
        if (location.searchSnippet) {
          entityUrl.searchParams.set('search_snippet', location.searchSnippet);
        }
        break;
      case 'call_record':
        if (location.transcriptId) {
          entityUrl.searchParams.set(
            CALL_PARAMS.transcriptId,
            location.transcriptId
          );
        }
        break;
    }
  }

  window.open(entityUrl.toString(), '_blank', 'noopener');
};

/**
 * Restores DOM focus to an entity row in the soup view after a modal action completes.
 * This is necessary because the hotkey system is focus-based, and modals steal
 * focus away from the soup view. Without restoring DOM focus, scoped hotkeys
 * like 'escape' won't work.
 *
 * @param entityId - Optional entity ID to focus on. If not provided, focuses the first entity in the list.
 * @param inPreview - Whether to check for the soup view in a preview panel
 */
export const restoreSoupFocus = async (
  entityId?: string,
  inPreview = false
): Promise<void> => {
  // Get the active split's soup view DOM reference
  const activeSplitId = globalSplitManager()?.activeSplitId();
  if (!activeSplitId) return;

  let domRef = document.querySelector(`[data-soup-view-id="${activeSplitId}"]`);

  if (inPreview) {
    domRef = document.querySelector(
      `[data-soup-view-id="${activeSplitId}-preview"]`
    );
  }

  if (!(domRef instanceof HTMLElement)) return;

  // Wait for DOM to update after modal closes
  await waitForFrames(2);

  // Entity rows are plain divs without a `tabindex` attribute so `.focus()`
  // on them is a no-op. Targeting them is still useful because the browser
  // may scroll them into view as part of the focus attempt. Always follow
  // up by focusing the soup container (which has `tabindex={-1}`) — that's
  // what actually reactivates the hotkey scope.
  if (entityId) {
    const entityEl = domRef.querySelector(entityIdSelector(entityId));
    if (entityEl instanceof HTMLElement) entityEl.focus();
  }

  if (document.activeElement && domRef.contains(document.activeElement)) return;

  const firstEntityEl = domRef.querySelector(`[${ENTITY_ID_DATA_ATTRIBUTE}]`);
  if (firstEntityEl instanceof HTMLElement) firstEntityEl.focus();

  if (document.activeElement && domRef.contains(document.activeElement)) return;

  domRef.focus();
};

interface OpenEntityOptions {
  openInNewSplit?: boolean;
  location?: SearchLocation;
  splitHandle?: SplitHandle;
  mergeHistory?: boolean;
  allowDuplicate?: boolean;
}

/**
 * Opens an entity in a split, handling navigation to specific locations within the entity.
 * Supports both regular entities (channel, email, etc.) and document entities.
 *
 * @param entity - The entity to open
 * @param options - Configuration options including whether to open in new split, location, and split handle
 */
export const openEntityInSplitFromUnifiedList = async (
  entity: EntityData,
  options: OpenEntityOptions
): Promise<void> => {
  const { allowDuplicate, openInNewSplit, splitHandle, mergeHistory } = options;
  let { location } = options;

  if (!location && isSnippetEntity(entity)) {
    location = getSnippetHit(entity)?.location;
  }

  // Get dependencies internally
  const splitManager = globalSplitManager();
  if (!splitManager) {
    console.error('No split manager found');
    return;
  }

  // TODO(dev-rb/github): Route GitHub PRs to /pr.
  if (isGithubPrEntity(entity)) {
    openExternalUrl(entity.metadata.url);
    return;
  }
  if (entity.type === 'foreign') return;

  const blockOrchestrator = splitManager.getOrchestrator();

  const content = getEntitySplitContent(entity);

  let params: Record<string, string> | undefined;
  if (entity.type === 'channel' && location?.type === 'channel') {
    params = getChannelParams(location.messageId, location.threadId);
  } else if (entity.type === 'channel_message') {
    params = getChannelParams(entity.messageId, entity.threadId);
  } else if (entity.type === 'call' && location?.type === 'call_record') {
    params = { [CALL_PARAMS.transcriptId]: location.transcriptId };
  }

  splitManager.openWithSplit(
    { ...content, params },
    {
      referredFrom: 'list-view',
      activate: true,
      preferNewSplit: openInNewSplit,
      handle: splitHandle,
      mergeHistory,
      allowDuplicate,
    }
  );

  // Navigate to specific location if provided
  if (location) {
    await navigateToLocation(content.id, location, blockOrchestrator);
  } else if (entity.type === 'channel_message') {
    // NOTE: This will force target message navigation in case the split is already open.
    await navigateToLocation(
      entity.channelId,
      {
        type: 'channel',
        messageId: entity.messageId,
        threadId: entity.threadId,
      },
      blockOrchestrator
    );
  }
};

// TODO(dev-rb/github): Map GitHub PRs to { type: 'pr', id }.
function getEntitySplitContent(entity: EntityData) {
  return match(entity)
    .with({ type: 'document' }, (entity) => {
      const { id, fileType, subType } = entity;
      const blockName = fileTypeToBlockName(subType?.type ?? fileType);

      return { type: blockName, id };
    })
    .with({ type: 'channel_message' }, (entity) => {
      return { type: 'channel' as const, id: entity.channelId };
    })
    .with({ type: 'foreign' }, (entity) => {
      return { type: 'unknown' as const, id: entity.id };
    })
    .otherwise((entity) => {
      return { type: entity.type, id: entity.id };
    });
}

/**
 * Navigates to a specific location within a block.
 */
async function navigateToLocation(
  entityId: string,
  location: SearchLocation,
  blockOrchestrator: BlockOrchestrator
): Promise<void> {
  const blockHandle = await blockOrchestrator.getBlockHandle(entityId);
  if (!blockHandle) return;

  switch (location.type) {
    case 'channel': {
      // NOTE: this is handled by the channel block params but this can be used to re-flash an open channel
      await blockHandle.goToLocationFromParams(
        getChannelParams(location.messageId, location.threadId)
      );
      break;
    }
    case 'email': {
      await blockHandle.goToLocationFromParams({
        [EMAIL_PARAMS.messageId]: location.messageId,
      });
      break;
    }
    case 'md': {
      await blockHandle.goToLocationFromParams({
        [MD_PARAMS.nodeId]: location.nodeId,
      });
      break;
    }
    case 'pdf': {
      await blockHandle.goToLocationFromParams({
        [PDF_PARAMS.searchPage]: location.searchPage.toString(),
        [PDF_PARAMS.searchRawQuery]: location.searchRawQuery,
        [PDF_PARAMS.searchHighlightTerms]: JSON.stringify(
          location.highlightTerms
        ),
        [PDF_PARAMS.searchSnippet]: location.searchSnippet,
      });
      break;
    }
    case 'call_record': {
      await blockHandle.goToLocationFromParams({
        [CALL_PARAMS.transcriptId]: location.transcriptId,
      });
      break;
    }
  }
}

async function _archiveEmail(
  id: string,
  options: { archive: boolean; optimisticallyExclude?: boolean }
) {
  await queryClient.cancelQueries({ queryKey: queryKeys.all.email });

  const previousEmail = queryClient.getQueriesData<{
    pages: { items: EntityData[] }[];
  }>({
    queryKey: queryKeys.all.email,
  });

  const current = getSoupEntityById(id);
  const soupTxn = options.optimisticallyExclude
    ? removeSoupEntities(new Set([id]))
    : optimisticUpdateSoupEntity({
        tag: 'emailThread',
        data: { id, inboxVisible: false },
        frecency_score: current?.frecency_score ?? 0,
      });

  // Optimistic update for email queries
  const applyEmailOptimistic = (data?: {
    pages: { items: EntityData[] }[];
  }) => {
    if (!data) return data;

    return {
      ...data,
      pages: data.pages.map((page) => ({
        ...page,
        items: options.optimisticallyExclude
          ? page.items.filter((item) => item.id !== id)
          : page.items.map((item) =>
              item.id === id ? { ...item, inboxVisible: false } : item
            ),
      })),
    };
  };

  for (const [key, data] of previousEmail) {
    queryClient.setQueryData(key, applyEmailOptimistic(data));
  }

  try {
    await emailClient.flagArchived({ value: options.archive, id });
  } catch (_err) {
    soupTxn.rollback();
    for (const [key, data] of previousEmail) {
      queryClient.setQueryData(key, data);
    }
  } finally {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: queryKeys.all.email }),
      invalidateSoupEntity(id),
    ]);
  }
}

type TrashEmailsHandle = {
  /** Fire-and-forget promise for the API calls. Rejects on failure (rolls back optimistic update). */
  done: Promise<void>;
  /** Optimistically restores all entities and calls the API to remove the TRASH label. */
  undo: () => Promise<void>;
};

/**
 * Optimistically removes one or more email threads from soup + email caches,
 * then fires the TRASH label API calls in the background. Takes a single
 * snapshot before all removals so undo restores the complete pre-trash state.
 * Returns synchronously so the caller can show the undo toast immediately.
 */
export function trashEmails(ids: string[]): TrashEmailsHandle {
  queryClient.cancelQueries({ queryKey: queryKeys.all.email });

  const previousEmail = queryClient.getQueriesData<{
    pages: { items: EntityData[] }[];
  }>({
    queryKey: queryKeys.all.email,
  });

  const idSet = new Set(ids);
  const soupTxn = removeSoupEntities(idSet);

  // Optimistically remove from email queries
  for (const [key, data] of previousEmail) {
    if (!data) continue;
    queryClient.setQueryData(key, {
      ...data,
      pages: data.pages.map((page) => ({
        ...page,
        items: page.items.filter((item) => !idSet.has(item.id)),
      })),
    });
  }

  const rollback = () => {
    soupTxn.rollback();
    for (const [key, data] of previousEmail) {
      queryClient.setQueryData(key, data);
    }
  };

  // Resolved lazily by the API calls; used by undo
  let trashLabelId: string | undefined;

  const done = (async () => {
    try {
      const labelsData = await queryClient.fetchQuery({
        queryKey: emailKeys.labels.queryKey,
        queryFn: async () =>
          throwOnErr(async () => await emailClient.getUserLabels()),
        staleTime: 5 * 60 * 1000,
      });
      const trashLabel = labelsData?.labels.find(
        (l) => l.providerLabelId === 'TRASH'
      );
      const labelId = trashLabel?.id;
      if (!labelId) {
        throw new Error('TRASH label not found');
      }
      trashLabelId = labelId;

      await Promise.all(
        ids.map((id) =>
          emailClient.updateThreadLabel({
            thread_id: id,
            label_id: labelId,
            value: true,
          })
        )
      );
    } catch (err) {
      rollback();
      throw err;
    } finally {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.all.email }),
        ...ids.map((id) => invalidateSoupEntity(id)),
      ]);
    }
  })();

  return {
    done,
    undo: async () => {
      // Wait for the trash calls to finish so we know the label ID.
      // If the trash call itself failed, rollback already happened — nothing to undo.
      try {
        await done;
      } catch {
        return;
      }

      rollback();

      try {
        await Promise.all(
          ids.map((id) =>
            emailClient.updateThreadLabel({
              thread_id: id,
              label_id: trashLabelId!,
              value: false,
            })
          )
        );
      } finally {
        // Only invalidate email queries — skip soup invalidation since
        // rollback() already restored the correct cache state.
        await queryClient.invalidateQueries({
          queryKey: queryKeys.all.email,
          refetchType: 'none',
        });
      }
    },
  };
}

export type MarkEntitiesDoneContext = {
  /** Clears optimistic state — use for mark-done failure (cache is pre-mutation). */
  rollback: () => void;
  /** Re-applies the optimistic done state. Use for redo / undo failure. */
  reapply: () => void;
  /** Reverts email/soup caches and forces `done=false` override. Use for undo. */
  applyUndone: () => void;
};

/**
 * Extract the email ids and notification ids targeted by a mark-done on these
 * entities. The ids are snapshotted here so mutationFn/undoFn/redoFn operate
 * on the set that existed at mutation time.
 */
export function resolveMarkEntitiesDoneVariables(args: {
  entities: EntityData[];
  notificationSource: NotificationSource;
}): { emailIds: string[]; notificationIds: string[] } {
  const { entities, notificationSource } = args;
  const emailIds = entities.filter((e) => e.type === 'email').map((e) => e.id);
  const notificationIds = entities.flatMap((entity) => {
    return (
      notificationSource.notificationsByEntity()[
        compositeEntity(toNotificationEntity(entity))
      ] ?? []
    ).map((n) => n.id);
  });
  return { emailIds, notificationIds };
}

/**
 * Applies the optimistic UI state for marking entities as done — removes
 * emails from the soup + email caches and flips the notification `done`
 * override. Returns a context the mutation uses for rollback / reapply.
 */
export function applyEntitiesDoneOptimistic(args: {
  entityIds: string[];
  emailIds: string[];
  notificationIds: string[];
}): MarkEntitiesDoneContext {
  const { entityIds, emailIds, notificationIds } = args;
  const emailIdSet = new Set(emailIds);
  const entityIdSet = new Set(entityIds);

  // Snapshot the affected notifications before marking done. A done
  // notification gets dropped from the cache (status-update event or a stale
  // refetch), so undo re-adds it here so the soup `notDoneFilter` predicate
  // lets the restored entity through again.
  const notificationSnapshots = snapshotUserNotifications(notificationIds);

  type EmailQueryKey = readonly unknown[];
  type EmailCacheData = { pages: { items: EntityData[] }[] };
  const removedEmails = new Map<EmailQueryKey, Map<string, EntityData>>();

  const filterEmailCache = () => {
    if (emailIdSet.size === 0) return;
    for (const [key, data] of queryClient.getQueriesData<EmailCacheData>({
      queryKey: queryKeys.all.email,
    })) {
      if (!data) continue;
      const bucket = removedEmails.get(key) ?? new Map<string, EntityData>();
      let mutated = false;
      const pages = data.pages.map((page) => {
        const items: EntityData[] = [];
        for (const item of page.items) {
          if (emailIdSet.has(item.id)) {
            bucket.set(item.id, item);
            mutated = true;
          } else {
            items.push(item);
          }
        }
        return mutated && items.length !== page.items.length
          ? { ...page, items }
          : page;
      });
      if (mutated) {
        removedEmails.set(key, bucket);
        queryClient.setQueryData(key, { ...data, pages });
      }
    }
  };

  const restoreEmailCache = () => {
    for (const [key, bucket] of removedEmails) {
      if (bucket.size === 0) continue;
      const toRestore = [...bucket.values()];
      bucket.clear();
      queryClient.setQueryData<EmailCacheData>(key, (current) => {
        if (!current) return current;
        const restoredIds = new Set(toRestore.map((e) => e.id));
        return {
          ...current,
          pages: current.pages.map((page, idx) => {
            const filtered = page.items.filter((i) => !restoredIds.has(i.id));
            if (idx === 0) {
              return { ...page, items: [...toRestore, ...filtered] };
            }
            if (filtered.length === page.items.length) {
              return page;
            }
            return { ...page, items: filtered };
          }),
        };
      });
    }
  };

  let soupTxn: ReturnType<typeof removeSoupEntities> | null = null;

  const reapply = () => {
    // Remove every marked entity from the soup feed cache so the hide is
    // authoritative for all types; undo restores them via this transaction's
    // rollback.
    soupTxn = entityIds.length > 0 ? removeSoupEntities(entityIdSet) : null;
    filterEmailCache();
    setDoneOverride(notificationIds, true);
  };

  const rollback = () => {
    soupTxn?.rollback();
    soupTxn = null;
    restoreEmailCache();
    setDoneOverride(notificationIds, undefined);
  };

  const applyUndone = () => {
    soupTxn?.rollback();
    soupTxn = null;
    restoreEmailCache();
    restoreUserNotifications(notificationSnapshots);
    // Force `done=false` — cache may have reconciled to `done=true` from the
    // server, so clearing the override would leave the UI hidden after undo.
    setDoneOverride(notificationIds, false);
  };

  reapply();

  return { rollback, reapply, applyUndone };
}

/**
 * Fires the archive + bulk-done APIs for the given ids. Throws on any
 * failure; caller is responsible for rollback via the context returned by
 * `applyEntitiesDoneOptimistic`.
 */
export async function executeMarkEntitiesDone(args: {
  emailIds: string[];
  notificationIds: string[];
}): Promise<void> {
  const { emailIds, notificationIds } = args;
  await Promise.all([
    queryClient.cancelQueries({ queryKey: queryKeys.all.email }),
    queryClient.cancelQueries({ queryKey: notificationKeys.user._def }),
  ]);

  const results = await Promise.allSettled([
    ...emailIds.map((id) =>
      throwOnErr(
        async () => await emailClient.flagArchived({ value: true, id })
      )
    ),
    notificationIds.length > 0
      ? bulkMarkNotificationsAsDone(notificationIds)
      : Promise.resolve(),
  ]);

  const rejected = results.find(
    (r): r is PromiseRejectedResult => r.status === 'rejected'
  );

  if (rejected) {
    // Real refetch to reconcile server state with the UI after the caller
    // rolls back its optimistic cache writes.
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: queryKeys.all.email }),
      queryClient.invalidateQueries({ queryKey: notificationKeys.user._def }),
      ...emailIds.map((id) => invalidateSoupEntity(id)),
    ]);
    throw rejected.reason ?? new Error('Failed to mark as done');
  }

  await Promise.all([
    queryClient.invalidateQueries({
      queryKey: queryKeys.all.email,
      refetchType: 'none',
    }),
    queryClient.invalidateQueries({
      queryKey: notificationKeys.user._def,
      refetchType: 'none',
    }),
    ...emailIds.map((id) => invalidateSoupEntity(id)),
  ]);
}

/**
 * Fires the unarchive + bulk-undone APIs for the given ids. Throws on any
 * failure; caller is responsible for re-applying optimistic state.
 */
export async function executeMarkEntitiesUndone(args: {
  emailIds: string[];
  notificationIds: string[];
}): Promise<void> {
  const { emailIds, notificationIds } = args;
  await Promise.all([
    queryClient.cancelQueries({ queryKey: queryKeys.all.email }),
    queryClient.cancelQueries({ queryKey: notificationKeys.user._def }),
  ]);

  const results = await Promise.allSettled([
    ...emailIds.map((id) =>
      throwOnErr(
        async () => await emailClient.flagArchived({ value: false, id })
      )
    ),
    notificationIds.length > 0
      ? bulkMarkNotificationsAsUndone(notificationIds)
      : Promise.resolve(),
  ]);

  const rejected = results.find(
    (r): r is PromiseRejectedResult => r.status === 'rejected'
  );

  if (rejected) {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: queryKeys.all.email }),
      queryClient.invalidateQueries({ queryKey: notificationKeys.user._def }),
    ]);
    throw rejected.reason ?? new Error('Failed to undo');
  }

  await Promise.all([
    queryClient.invalidateQueries({
      queryKey: queryKeys.all.email,
      refetchType: 'none',
    }),
    queryClient.invalidateQueries({
      queryKey: notificationKeys.user._def,
      refetchType: 'none',
    }),
  ]);
}
