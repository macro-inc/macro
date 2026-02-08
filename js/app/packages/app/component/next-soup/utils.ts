import type { BlockOrchestrator } from '@core/orchestrator';
import { URL_PARAMS as CHANNEL_PARAMS } from '@block-channel/constants';
import { URL_PARAMS as EMAIL_PARAMS } from '@block-email/constants';
import { URL_PARAMS as MD_PARAMS } from '@block-md/constants';
import { URL_PARAMS as PDF_PARAMS } from '@block-pdf/signal/location';
import type {
  SplitContent,
  SplitHandle,
} from '@app/component/split-layout/layoutManager';
import { globalSplitManager } from '@app/signal/splitLayout';
import { fileTypeToBlockName } from '@core/constant/allBlocks';
import { waitForFrames } from '@core/util/sleep';
import {
  type DocumentEntity,
  type EntityData,
  isSearchEntity,
  queryKeys,
  type SearchLocation,
  type TaskEntityWithProperties,
  type WithSearch,
} from '@macro-entity';
import { queryClient } from '@queries/client';
import { emailClient } from '@service-email/client';
import {
  PROPERTY_OPTION_IDS,
  SYSTEM_PROPERTY_IDS,
} from '@core/component/Properties/constants';

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
const getEntityTimestamp = (entity: EntityData): number => {
  return entity.updatedAt ?? entity.createdAt ?? 0;
};

/**
 * Returns true if the new entity should replace the existing one based on timestamp. If the timestamp is the same, prefer to use the newer entity to handle optimistic updates
 */
export const isNewerEntity = (
  newEntity: EntityData,
  existing: EntityData
): boolean => {
  return getEntityTimestamp(newEntity) >= getEntityTimestamp(existing);
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
  } else {
    entityPath = `/app/${entity.type}/${entity.id}`;
  }

  // Add location params if present
  const entityUrl = new URL(entityPath, window.location.origin);
  if (location) {
    switch (location.type) {
      case 'channel':
        if (location.messageId) {
          entityUrl.searchParams.set('channel_message_id', location.messageId);
        }
        if (location.threadId) {
          entityUrl.searchParams.set('thread', location.threadId);
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

  if (!domRef) return;

  // Wait for DOM to update after modal closes
  await waitForFrames(2);

  // Find and focus the entity element
  if (entityId) {
    const entityEl = domRef.querySelector(`[data-entity-id="${entityId}"]`);
    if (entityEl instanceof HTMLElement) {
      entityEl.focus();
      return;
    }
  }

  // Fallback: focus the first entity in the list if no specific entity to focus
  const firstEntityEl = domRef.querySelector('[data-entity-id]');
  if (firstEntityEl instanceof HTMLElement) {
    firstEntityEl.focus();
  }
};

export interface OpenEntityOptions {
  openInNewSplit?: boolean;
  location?: SearchLocation;
  splitHandle: SplitHandle;
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
  const { openInNewSplit, location, splitHandle } = options;

  // Get dependencies internally
  const splitManager = globalSplitManager();
  if (!splitManager) {
    console.error('No split manager found');
    return;
  }

  const blockOrchestrator = splitManager.getOrchestrator();

  // Create split functions
  const insertSplit = (content: SplitContent) => {
    return splitManager.createNewSplit({
      content,
      activate: true,
      referredFrom: 'unified-list',
    });
  };

  const replaceOrInsertSplit = (content: SplitContent) => {
    const existingSplit = splitManager.getSplitByContent(
      content.type,
      content.id
    );
    if (existingSplit) {
      return existingSplit;
    }

    splitHandle.replace({ next: content, referredFrom: 'unified-list' });
    return splitHandle;
  };

  // Handle document entities separately
  if (entity.type === 'document') {
    return openDocument(entity as DocumentEntity, {
      openInNewSplit,
      blockOrchestrator,
      location,
      insertSplit,
      replaceOrInsertSplit,
    });
  }

  // Build params for channel entities with location
  const params =
    entity.type === 'channel' && location?.type === 'channel'
      ? {
          [CHANNEL_PARAMS.message]: location.messageId,
          [CHANNEL_PARAMS.thread]: location.threadId,
        }
      : undefined;

  // Create or replace split based on openInNewSplit option
  const handle = openInNewSplit
    ? insertSplit({ type: entity.type, id: entity.id, params })
    : replaceOrInsertSplit({ type: entity.type, id: entity.id, params });

  handle?.activate();

  // Navigate to specific location if provided
  if (!location) return;

  await navigateToLocation(entity.id, location, blockOrchestrator);
};

/**
 * Opens a document entity in a split.
 */
async function openDocument(
  entity: DocumentEntity,
  options: {
    openInNewSplit?: boolean;
    blockOrchestrator: BlockOrchestrator;
    location?: SearchLocation;
    insertSplit: (content: SplitContent) => SplitHandle | undefined;
    replaceOrInsertSplit: (content: SplitContent) => SplitHandle | undefined;
  }
): Promise<void> {
  const {
    openInNewSplit,
    blockOrchestrator,
    location,
    insertSplit,
    replaceOrInsertSplit,
  } = options;

  const { id, fileType, subType } = entity;
  const blockName = fileTypeToBlockName(subType?.type ?? fileType);

  // Create or replace split based on openInNewSplit option
  const handle = openInNewSplit
    ? insertSplit({ type: blockName, id })
    : replaceOrInsertSplit({ type: blockName, id });

  handle?.activate();

  // Navigate to specific location if provided
  if (!location) return;

  await navigateToLocation(id, location, blockOrchestrator);
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
      await blockHandle.goToLocationFromParams({
        [CHANNEL_PARAMS.thread]: location.threadId,
        [CHANNEL_PARAMS.message]: location.messageId,
      });
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
  }
}

export async function archiveEmail(
  id: string,
  options: { isDone: boolean; optimisticallyExclude?: boolean }
) {
  await Promise.all([
    queryClient.cancelQueries({ queryKey: queryKeys.all.email }),
    queryClient.cancelQueries({ queryKey: queryKeys.all.dss }),
  ]);

  const previousEmail = queryClient.getQueriesData<{
    pages: { items: EntityData[] }[];
  }>({
    queryKey: queryKeys.all.email,
  });
  const previousEmailThreadItemFromDss = queryClient.getQueriesData<{
    pages: { items: EntityData[] }[];
  }>({
    queryKey: queryKeys.all.dss,
  });

  const applyOptimistic = (data?: {
    pages: { items: (EntityData | { data: EntityData })[] }[];
  }) => {
    if (!data) return data;

    return {
      ...data,
      pages: data.pages.map((page) => ({
        ...page,
        items: options.optimisticallyExclude
          ? page.items.filter((item) => {
              if ('data' in item) {
                return item.data.id !== id;
              }
              return item.id !== id;
            })
          : page.items.map((item) => {
              if ('data' in item) {
                return item.data.id === id
                  ? {
                      ...item,
                      data: {
                        ...item.data,
                        inboxVisible: false,
                      },
                    }
                  : item;
              }
              return item.id === id
                ? {
                    ...item,
                    inboxVisible: false,
                  }
                : item;
            }),
      })),
    };
  };

  for (const [key, data] of [
    ...previousEmailThreadItemFromDss,
    ...previousEmail,
  ]) {
    queryClient.setQueryData(key, applyOptimistic(data));
  }

  try {
    // server mutation
    await emailClient.flagArchived({ value: !options.isDone, id });
  } catch (_err) {
    // rollback on error
    for (const [key, data] of previousEmail) {
      queryClient.setQueryData(key, data);
    }
    for (const [key, data] of previousEmailThreadItemFromDss) {
      queryClient.setQueryData(key, data);
    }
  } finally {
    // revalidate
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: queryKeys.all.email }),
      queryClient.invalidateQueries({ queryKey: queryKeys.all.dss }),
    ]);
  }
}

/**
 * extracts assignee user ids from task properties.
 */
export const getTaskAssigneeIds = (
  entity: TaskEntityWithProperties
): string[] => {
  const properties = entity.properties;
  if (!properties) return [];
  const assigneesProperty = properties.find(
    (p) => p.definition.id === SYSTEM_PROPERTY_IDS.ASSIGNEES
  );
  if (!assigneesProperty?.value) return [];

  const value = assigneesProperty.value;
  if (value.type === 'EntityReference' && Array.isArray(value.value)) {
    return value.value
      .filter((ref) => ref.entity_type === 'USER')
      .map((ref) => ref.entity_id);
  }

  return [];
};

/**
 * gets the status option id from task properties.
 */
export const getTaskStatusOptionId = (
  entity: TaskEntityWithProperties
): string | undefined => {
  const properties = entity.properties;
  if (!properties) return undefined;

  const statusProperty = properties.find(
    (p) => p.definition.id === SYSTEM_PROPERTY_IDS.STATUS
  );
  if (!statusProperty?.value) return undefined;

  const value = statusProperty.value;
  if (
    value.type === 'SelectOption' &&
    'value' in value &&
    Array.isArray(value.value)
  ) {
    return value.value[0];
  }

  return undefined;
};

/**
 * checks if a task is in a "closed" state (completed or canceled).
 */
export const isTaskClosed = (entity: TaskEntityWithProperties): boolean => {
  if (entity.subType?.is_completed === true) {
    return true;
  }
  const statusOptionId = getTaskStatusOptionId(entity);
  if (
    statusOptionId === PROPERTY_OPTION_IDS.STATUS.COMPLETED ||
    statusOptionId === PROPERTY_OPTION_IDS.STATUS.CANCELED
  ) {
    return true;
  }
  return false;
};

/**
 * checks if the current user is assigned to the task.
 */
export const isCurrentUserAssigned = (
  entity: TaskEntityWithProperties,
  currentUserId: string | undefined
): boolean => {
  if (!currentUserId) return false;
  const assigneeIds = getTaskAssigneeIds(entity);
  if (assigneeIds.length === 0) return true;
  return assigneeIds.includes(currentUserId);
};
