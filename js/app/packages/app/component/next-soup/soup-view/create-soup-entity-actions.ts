import { useGlobalNotificationSource } from '@app/component/GlobalAppState';
import { globalSplitManager } from '@app/signal/splitLayout';
import { fileTypeToBlockName, itemToBlockName } from '@core/constant/allBlocks';
import type { EntityData } from '@entity';
import {
  makeBlockSenderAction,
  makeCopyAction,
  makeCopyBranchNameAction,
  makeCopyEntityIdAction,
  makeCopyLinkAction,
  makeDeleteAction,
  makeMarkDoneAction,
  makeMarkSenderNoiseAction,
  makeMarkSenderSignalAction,
  makeMoveToProjectAction,
  makeRenameAction,
  makeShareAction,
} from '../actions';
import type { SoupState } from '../create-soup-state';
import { useUserId } from '@core/context/user';
import { useAnalytics } from '@app/component/analytics-context';
import { getChannelParams } from '@block-channel/utils/link';
import { isMobile } from '@core/mobile/isMobile';
import { canExecuteMarkDoneOnView } from '@app/component/next-soup/actions/make-mark-done-action';
import { isListViewID } from '@app/constants/list-views';

const SIGNAL_TABS = new Set<string | undefined>([
  undefined,
  'signal',
  'important',
]);
const NOISE_TABS = new Set(['noise']);

export type SoupEntityActionItem = {
  id: string;
  label: string;
  onClick: () => void | Promise<void>;
  destructive?: boolean;
};

export type SoupEntityActionGroup = {
  items: SoupEntityActionItem[];
};

type BuildActionGroups = (
  soup: SoupState,
  entities: EntityData[],
  context: {
    activeListView: string;
    activeTab: string | undefined;
  }
) => SoupEntityActionGroup[];

export function createSoupEntityActions(): {
  buildActionGroups: BuildActionGroups;
} {
  const analytics = useAnalytics();
  const userId = useUserId();
  const notificationSource = useGlobalNotificationSource();

  const markDone = makeMarkDoneAction({
    userId: () => userId(),
    notificationSource: () => notificationSource,
  });

  const deleteAction = makeDeleteAction({
    userId: () => userId(),
  });

  const renameAction = makeRenameAction({
    userId: () => userId(),
  });

  const copyAction = makeCopyAction();
  const moveToProjectAction = makeMoveToProjectAction();
  const copyLinkAction = makeCopyLinkAction();
  const copyBranchNameAction = makeCopyBranchNameAction();
  const copyEntityIdAction = makeCopyEntityIdAction();
  const shareAction = makeShareAction();
  const blockSenderAction = makeBlockSenderAction();
  const markSenderSignalAction = makeMarkSenderSignalAction();
  const markSenderNoiseAction = makeMarkSenderNoiseAction();

  const buildActionGroups: BuildActionGroups = (
    soup,
    entities,
    { activeTab, activeListView }
  ) => {
    const canExecuteAll = (canExecute: (e: EntityData) => boolean) =>
      entities.length > 0 && entities.every(canExecute);

    const handle =
      (execute: (entities: EntityData[], soup: SoupState) => Promise<void>) =>
      () =>
        execute(entities, soup);

    // Top group: Mark Done, Open in new split
    const topItems: SoupEntityActionItem[] = [];

    if (
      activeTab &&
      isListViewID(activeListView) &&
      canExecuteMarkDoneOnView(activeListView, activeTab) &&
      canExecuteAll(markDone.canExecute)
    ) {
      topItems.push({
        id: 'mark-done',
        label: 'Mark Done',
        onClick: handle(markDone.executeWithSoup),
      });
    }

    const canOpenInSplit = () => {
      if (isMobile()) return false;
      if (entities.length !== 1) return false;
      const entity = entities[0];
      const splitManager = globalSplitManager();
      if (!splitManager) return false;
      const contentId =
        entity.type === 'channel_message' ? entity.channelId : entity.id;
      const contentType = itemToBlockName(entity);
      return !splitManager.getSplitByContent(contentType, contentId);
    };

    if (canOpenInSplit()) {
      const openInNewSplit = async () => {
        const entity = entities[0];
        if (!entity) return;

        const splitManager = globalSplitManager();
        if (!splitManager) return;

        analytics.track('split_created', {
          from: 'soup_view_entity_actions_menu',
        });

        if (entity.type === 'document') {
          const { fileType, id, subType } = entity;
          splitManager.createNewSplit({
            content: {
              type: fileTypeToBlockName(subType?.type ?? fileType),
              id,
            },
            referredFrom: 'entity-actions-menu',
          });
        } else if (entity.type === 'channel_message') {
          splitManager.createNewSplit({
            content: {
              type: 'channel',
              id: entity.channelId,
              params: getChannelParams(entity.messageId, entity.threadId),
            },
            referredFrom: 'entity-actions-menu',
          });

          const orchestrator = splitManager.getOrchestrator();
          const blockHandle = await orchestrator.getBlockHandle(
            entity.channelId,
            'channel'
          );

          await blockHandle?.goToLocationFromParams(
            getChannelParams(entity.messageId, entity.threadId)
          );
        } else {
          splitManager.createNewSplit({
            content: {
              type: entity.type,
              id: entity.id,
            },
            referredFrom: 'entity-actions-menu',
          });
        }
      };

      topItems.push({
        id: 'open-in-split',
        label: 'Open in new split',
        onClick: openInNewSplit,
      });
    }

    // Middle group: Rename, Move to folder, Duplicate, Copy Link, Copy Branch Name, Share
    const middleItems: SoupEntityActionItem[] = [];

    if (canExecuteAll(renameAction.canExecute)) {
      middleItems.push({
        id: 'rename',
        label: 'Rename',
        onClick: handle(renameAction.executeWithSoup),
      });
    }

    if (canExecuteAll(moveToProjectAction.canExecute)) {
      middleItems.push({
        id: 'move-to-folder',
        label: 'Move to folder',
        onClick: handle(moveToProjectAction.executeWithSoup),
      });
    }

    if (canExecuteAll(copyAction.canExecute)) {
      middleItems.push({
        id: 'duplicate',
        label: 'Duplicate',
        onClick: handle(copyAction.executeWithSoup),
      });
    }

    if (entities.length === 1) {
      middleItems.push({
        id: 'copy-link',
        label: 'Copy Link',
        onClick: handle(copyLinkAction.executeWithSoup),
      });

      if (copyBranchNameAction.canExecute(entities[0])) {
        middleItems.push({
          id: 'copy-branch-name',
          label: 'Copy Branch Name',
          onClick: handle(copyBranchNameAction.executeWithSoup),
        });
      }

      middleItems.push({
        id: 'copy-entity-id',
        label: 'Copy ID',
        onClick: handle(copyEntityIdAction.executeWithSoup),
      });

      if (shareAction.canExecute(entities[0])) {
        middleItems.push({
          id: 'share',
          label: 'Share',
          onClick: handle(shareAction.executeWithSoup),
        });
      }
    }

    // Sender group: Sender → Signal, Sender → Noise, Block Sender
    const senderItems: SoupEntityActionItem[] = [];

    if (
      NOISE_TABS.has(activeTab ?? '') &&
      canExecuteAll(markSenderSignalAction.canExecute)
    ) {
      senderItems.push({
        id: 'sender-signal',
        label: 'Sender → Signal',
        onClick: handle(markSenderSignalAction.executeWithSoup),
      });
    }

    if (
      SIGNAL_TABS.has(activeTab) &&
      canExecuteAll(markSenderNoiseAction.canExecute)
    ) {
      senderItems.push({
        id: 'sender-noise',
        label: 'Sender → Noise',
        onClick: handle(markSenderNoiseAction.executeWithSoup),
      });
    }

    if (canExecuteAll(blockSenderAction.canExecute)) {
      senderItems.push({
        id: 'block-sender',
        label: 'Block Sender',
        onClick: handle(blockSenderAction.executeWithSoup),
      });
    }

    // Delete group
    const deleteItems: SoupEntityActionItem[] = [];

    if (canExecuteAll(deleteAction.canExecute)) {
      deleteItems.push({
        id: 'delete',
        label: 'Delete',
        onClick: handle(deleteAction.executeWithSoup),
        destructive: true,
      });
    }

    return [topItems, middleItems, senderItems, deleteItems]
      .filter((items) => items.length > 0)
      .map((items) => ({ items }));
  };

  return { buildActionGroups };
}
