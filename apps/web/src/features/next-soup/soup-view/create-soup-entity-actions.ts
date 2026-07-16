import { isListViewID } from '@app/constants/list-views';
import { canExecuteMarkDoneOnView } from '@app/features/next-soup/actions/make-mark-done-action';
import { useAnalytics } from '@app/lib/analytics/analytics-context';
import { globalSplitManager } from '@app/signal/splitLayout';
import {
  getChannelParams,
  goToChannelMessage,
} from '@block-channel/utils/link';
import { useGlobalNotificationSource } from '@components/app/GlobalAppState';
import { fileTypeToBlockName, itemToBlockName } from '@core/constant/allBlocks';
import { useUserId } from '@core/context/user';
import { type HotkeyToken, TOKENS } from '@core/hotkey/tokens';
import { isMobile } from '@core/mobile/isMobile';
import type { EntityData } from '@entity';
import { useSetCompanyHiddenMutation } from '@queries/crm/companies';
import type { Component, JSX } from 'solid-js';
import {
  makeBlockSenderAction,
  makeCopyAction,
  makeCopyBranchNameAction,
  makeCopyEntityIdAction,
  makeCopyLinkAction,
  makeDeleteAction,
  makeFavoriteAction,
  makeHideCompanyAction,
  makeMarkDoneAction,
  makeMarkSenderNoiseAction,
  makeMarkSenderSignalAction,
  makeMoveToProjectAction,
  makeRemoveFromProjectAction,
  makeRenameAction,
  makeSetCompanyPropertyAction,
  makeShareAction,
} from '../actions';
import type { SoupState } from '../create-soup-state';
import { getChannelEntityTarget } from '../utils';

const SIGNAL_TABS = new Set<string | undefined>([
  undefined,
  'signal',
  'important',
]);
const NOISE_TABS = new Set(['noise']);

type SoupEntityActionItem = {
  id: string;
  label: string;
  icon?: Component<JSX.SvgSVGAttributes<SVGSVGElement>>;
  hotkeyToken?: HotkeyToken;
  shortcut?: string;
  onClick: () => void | Promise<void>;
  destructive?: boolean;
};

type SoupEntityActionGroup = {
  items: SoupEntityActionItem[];
};

type BuildActionGroups = (
  soup: SoupState,
  entities: EntityData[],
  context: {
    activeListView: string;
    activeTab: string | undefined;
    /** Set when the list is a folder's contents (project block view) */
    viewedProjectId?: string;
    // Provided only where the menu host can anchor a tag picker for the
    // right-clicked row.
    openTagPicker?: () => void;
  }
) => SoupEntityActionGroup[];

/** The folder whose contents the split is showing, if any. */
export const viewedProjectIdFromContent = (content: {
  type: string;
  id: string;
}): string | undefined =>
  content.type === 'project' && content.id !== 'root' && content.id !== 'trash'
    ? content.id
    : undefined;

export function createSoupEntityActions(): {
  buildActionGroups: BuildActionGroups;
} {
  const analytics = useAnalytics();
  const userId = useUserId();
  const notificationSource = useGlobalNotificationSource();
  const hiddenMutation = useSetCompanyHiddenMutation();

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
  const favoriteAction = makeFavoriteAction();
  const moveToProjectAction = makeMoveToProjectAction();
  const removeFromProjectAction = makeRemoveFromProjectAction();
  const copyLinkAction = makeCopyLinkAction();
  const copyBranchNameAction = makeCopyBranchNameAction();
  const copyEntityIdAction = makeCopyEntityIdAction();
  const shareAction = makeShareAction();
  const blockSenderAction = makeBlockSenderAction();
  const markSenderSignalAction = makeMarkSenderSignalAction();
  const markSenderNoiseAction = makeMarkSenderNoiseAction();
  const hideCompanyAction = makeHideCompanyAction({
    setHidden: (companyId, hidden) =>
      hiddenMutation.mutateAsync({ companyId, hidden }),
  });
  const setCompanyPropertyAction = makeSetCompanyPropertyAction();

  const buildActionGroups: BuildActionGroups = (
    soup,
    entities,
    { activeTab, activeListView, viewedProjectId, openTagPicker }
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
        hotkeyToken: TOKENS.entity.action.markDone,
        onClick: handle(markDone.executeWithSoup),
      });
    }

    const canOpenInSplit = () => {
      if (isMobile()) return false;
      if (entities.length !== 1) return false;
      const entity = entities[0];
      const splitManager = globalSplitManager();
      if (!splitManager) return false;
      // TODO(dev-rb/github): Allow GitHub PRs once they map to /pr.
      if (entity.type === 'foreign') return false;
      const contentId =
        entity.type === 'channel_message' || entity.type === 'channel_thread'
          ? entity.channelId
          : entity.id;
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
        } else if (
          entity.type === 'channel_message' ||
          entity.type === 'channel_thread'
        ) {
          // Thread rows are keyed by their root; getChannelEntityTarget
          // recovers the clicked reply from the driving notification so the
          // new split lands on it rather than the root message. These rows
          // always resolve to a message target (their own ids at worst), never
          // `latest`, which only a whole-channel row produces.
          const resolved = getChannelEntityTarget(entity);
          const target =
            resolved?.kind === 'message'
              ? resolved
              : { messageId: entity.messageId, threadId: entity.threadId };
          splitManager.createNewSplit({
            content: {
              type: 'channel',
              id: entity.channelId,
              params: getChannelParams(target.messageId, target.threadId),
            },
            referredFrom: 'entity-actions-menu',
          });

          await goToChannelMessage(
            splitManager.getOrchestrator(),
            entity.channelId,
            target.messageId,
            target.threadId
          );
        } else if (entity.type === 'crm_company') {
          splitManager.createNewSplit({
            content: {
              type: 'company',
              id: entity.id,
            },
            referredFrom: 'entity-actions-menu',
          });
        } else if (entity.type === 'crm_contact') {
          splitManager.createNewSplit({
            content: {
              type: 'contact',
              id: entity.id,
            },
            referredFrom: 'entity-actions-menu',
          });
        } else if (entity.type !== 'foreign') {
          splitManager.createNewSplit({
            content: {
              type: itemToBlockName(entity),
              id: entity.id,
            },
            referredFrom: 'entity-actions-menu',
          });
        }
      };

      topItems.push({
        id: 'open-in-split',
        label: 'Open in new split',
        shortcut: 'shift+enter',
        onClick: openInNewSplit,
      });
    }

    // Middle group: Rename, Move to folder, Duplicate, Copy Link, Copy Branch Name, Share
    const middleItems: SoupEntityActionItem[] = [];

    if (canExecuteAll(renameAction.canExecute)) {
      middleItems.push({
        id: 'rename',
        label: 'Rename',
        hotkeyToken: TOKENS.entity.action.rename,
        onClick: handle(renameAction.executeWithSoup),
      });
    }

    if (canExecuteAll(favoriteAction.canExecute)) {
      const allFavorited = entities.every((entity) =>
        favoriteAction.isFavorited(entity)
      );
      // No icon: the other items in this menu don't have one.
      middleItems.push({
        id: 'favorite',
        label: allFavorited ? 'Unfavorite' : 'Favorite',
        hotkeyToken: TOKENS.entity.action.favorite,
        onClick: handle(favoriteAction.executeWithSoup),
      });
    }

    if (entities.length === 1 && openTagPicker) {
      middleItems.push({
        id: 'add-label',
        label: 'Add label',
        onClick: openTagPicker,
      });
    }

    if (canExecuteAll(moveToProjectAction.canExecute)) {
      middleItems.push({
        id: 'move-to-folder',
        label: 'Move to folder',
        hotkeyToken: TOKENS.entity.action.moveToFolder,
        onClick: handle(moveToProjectAction.executeWithSoup),
      });
    }

    if (viewedProjectId && canExecuteAll(removeFromProjectAction.canExecute)) {
      middleItems.push({
        id: 'remove-from-folder',
        label: 'Remove from folder',
        onClick: handle(removeFromProjectAction.executeWithSoup),
      });
    }

    if (canExecuteAll(copyAction.canExecute)) {
      middleItems.push({
        id: 'duplicate',
        label: 'Duplicate',
        hotkeyToken: TOKENS.entity.action.copy,
        onClick: handle(copyAction.executeWithSoup),
      });
    }

    if (entities.length === 1) {
      middleItems.push({
        id: 'copy-link',
        label: 'Copy Link',
        hotkeyToken: TOKENS.entity.action.copyLink,
        onClick: handle(copyLinkAction.executeWithSoup),
      });

      if (copyBranchNameAction.canExecute(entities[0])) {
        middleItems.push({
          id: 'copy-branch-name',
          label: 'Copy Branch Name',
          hotkeyToken: TOKENS.entity.action.copyBranchName,
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

    // CRM group: Set stage/owner/revenue on the whole company
    // selection, Hide / Unhide for a single company.
    const crmItems: SoupEntityActionItem[] = [];

    if (canExecuteAll(setCompanyPropertyAction.canExecute)) {
      crmItems.push(
        {
          id: 'set-stage',
          label: 'Set stage',
          onClick: () => setCompanyPropertyAction.execute(entities, 'stage'),
        },
        {
          id: 'set-owner',
          label: 'Set owner',
          onClick: () => setCompanyPropertyAction.execute(entities, 'owner'),
        },
        {
          id: 'set-revenue',
          label: 'Set revenue',
          onClick: () => setCompanyPropertyAction.execute(entities, 'revenue'),
        }
      );
    }

    const singleEntity = entities.length === 1 ? entities[0] : undefined;
    if (
      singleEntity?.type === 'crm_company' &&
      hideCompanyAction.canExecute(singleEntity)
    ) {
      crmItems.push({
        id: 'hide-company',
        label: singleEntity.hidden ? 'Unhide' : 'Hide',
        onClick: handle(hideCompanyAction.executeWithSoup),
      });
    }

    // Delete group
    const deleteItems: SoupEntityActionItem[] = [];

    if (canExecuteAll(deleteAction.canExecute)) {
      deleteItems.push({
        id: 'delete',
        label: 'Delete',
        hotkeyToken: TOKENS.entity.action.delete,
        onClick: handle(deleteAction.executeWithSoup),
        destructive: true,
      });
    }

    return [topItems, middleItems, senderItems, crmItems, deleteItems]
      .filter((items) => items.length > 0)
      .map((items) => ({ items }));
  };

  return { buildActionGroups };
}
