import type { BlockChannelProps } from '@block-channel/component/Block';
import { URL_PARAMS as CHANNEL_PARAMS } from '@block-channel/constants';
import { URL_PARAMS as EMAIL_PARAMS } from '@block-email/constants';
import { URL_PARAMS as MD_PARAMS } from '@block-md/constants';
import { URL_PARAMS as PDF_PARAMS } from '@block-pdf/signal/location';
import { fileTypeToBlockName } from '@core/constant/allBlocks';
import type { BlockOrchestrator } from '@core/orchestrator';
import type { DocumentEntity, EntityData, SearchLocation } from '@macro-entity';
import { globalSplitManager } from '../signal/splitLayout';
import type { SplitContent, SplitHandle } from './split-layout/layoutManager';

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
      ? ({
          target: {
            threadId: location.threadId,
            messageId: location.messageId,
          },
        } as BlockChannelProps)
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
  const blockName = fileTypeToBlockName(subType ?? fileType);

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
