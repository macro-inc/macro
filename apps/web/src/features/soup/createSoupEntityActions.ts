import { createCrmEntityActionItems } from '@app/features/crm/crm-action-items';
import {
  type EntityActionListState,
  type EntityActionNavigationHandler,
  type EntityActionViewContext,
  makeBlockSenderAction,
  makeChannelPictureAction,
  makeCopyAction,
  makeCopyBranchNameAction,
  makeCopyEntityIdAction,
  makeCopyLinkAction,
  makeCreateReminderAction,
  makeDeleteAction,
  makeFavoriteAction,
  makeMarkDoneAction,
  makeMarkNotDoneAction,
  makeMarkNotificationsReadAction,
  makeMarkReadAction,
  makeMarkSenderNoiseAction,
  makeMarkSenderSignalAction,
  makeMarkUnreadAction,
  makeMoveToProjectAction,
  makeMuteAction,
  makeRemoveFromProjectAction,
  makeRenameAction,
  makeShareAction,
} from '@app/features/next-soup/actions';
import type { MarkDoneDelegate } from '@app/features/next-soup/actions/mark-done-delegate';
import {
  markCalendarNotificationSeenOnOpen,
  openEntityInSplitFromUnifiedList,
} from '@app/features/next-soup/utils';
import { useAnalytics } from '@app/lib/analytics/analytics-context';
import { useFeatureFlag } from '@app/lib/analytics/posthog';
import { t } from '@app/lib/i18n';
import { globalSplitManager } from '@app/signal/splitLayout';
import { useGlobalNotificationSource } from '@components/app/GlobalAppState';
import type { SplitHandle } from '@components/app/split-layout/layoutManager';
import { itemToBlockName } from '@core/constant/allBlocks';
import { enableProjects, isFeatureEnabled } from '@core/constant/featureFlags';
import { useUserId } from '@core/context/user';
import { type HotkeyToken, TOKENS } from '@core/hotkey/tokens';
import { isMobile } from '@core/mobile/isMobile';
import type { EntityData } from '@entity';
import { isEmailEntity, isTaskEntity } from '@entity';
import type { Component, JSX } from 'solid-js';

type SoupEntityActionItem = {
  id: string;
  label: string;
  icon?: Component<JSX.SvgSVGAttributes<SVGSVGElement>>;
  hotkeyToken?: HotkeyToken;
  shortcut?: string;
  onClick: () => void | Promise<void>;
  destructive?: boolean;
  disabled?: boolean;
};

type SoupEntityActionGroup = {
  items: SoupEntityActionItem[];
};

type BuildActionGroups = (
  soup: EntityActionListState,
  entities: EntityData[],
  context: {
    viewContext: EntityActionViewContext;
    /** Set when the list is a folder's contents (project block view) */
    viewedProjectId?: string;
    // Provided only where the menu host can anchor a tag picker for the
    // right-clicked row.
    openTagPicker?: () => void;
    openProjectPicker?: () => void;
    /**
     * The split hosting the list. Open actions route through it so they match
     * their click/hotkey equivalents.
     */
    splitHandle?: SplitHandle;
    /** Creates a view-owned follow-up for action-driven navigation. */
    createActionNavigationHandler?: () =>
      | EntityActionNavigationHandler
      | undefined;
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

export function createSoupEntityActions(
  options: {
    /** A list that completes its own rows, such as Home's work feed. */
    markDoneDelegate?: () => MarkDoneDelegate | undefined;
  } = {}
): {
  buildActionGroups: BuildActionGroups;
  isFavorited: (entity: EntityData) => boolean;
} {
  const analytics = useAnalytics();
  const projectsFlag = useFeatureFlag(enableProjects);
  const userId = useUserId();
  const notificationSource = useGlobalNotificationSource();
  const crmActions = createCrmEntityActionItems();

  const markDone = makeMarkDoneAction({
    userId: () => userId(),
    notificationSource: () => notificationSource,
    delegate: options.markDoneDelegate,
  });

  const markNotDone = makeMarkNotDoneAction({
    notificationSource: () => notificationSource,
  });

  const markRead = makeMarkReadAction();
  const markUnread = makeMarkUnreadAction();
  const markNotificationsRead = makeMarkNotificationsReadAction({
    notificationSource: () => notificationSource,
  });

  const deleteAction = makeDeleteAction({
    userId: () => userId(),
  });

  const renameAction = makeRenameAction({
    userId: () => userId(),
  });

  const channelPictureAction = makeChannelPictureAction();

  const copyAction = makeCopyAction();
  const favoriteAction = makeFavoriteAction();
  const muteAction = makeMuteAction({
    notificationSource: () => notificationSource,
  });
  const moveToProjectAction = makeMoveToProjectAction();
  const removeFromProjectAction = makeRemoveFromProjectAction();
  const copyLinkAction = makeCopyLinkAction();
  const copyBranchNameAction = makeCopyBranchNameAction();
  const copyEntityIdAction = makeCopyEntityIdAction();
  const createReminderAction = makeCreateReminderAction();
  const shareAction = makeShareAction();
  const blockSenderAction = makeBlockSenderAction();
  const markSenderSignalAction = makeMarkSenderSignalAction();
  const markSenderNoiseAction = makeMarkSenderNoiseAction();

  const buildActionGroups: BuildActionGroups = (
    soup,
    entities,
    {
      viewContext,
      viewedProjectId,
      openTagPicker,
      openProjectPicker,
      splitHandle,
      createActionNavigationHandler,
    }
  ) => {
    const canExecuteAll = (canExecute: (e: EntityData) => boolean) =>
      entities.length > 0 && entities.every(canExecute);

    const handle =
      (
        execute: (
          entities: EntityData[],
          soup: EntityActionListState
        ) => Promise<void>
      ) =>
      () =>
        execute(entities, soup);

    // Top group: Mark Done, Open in new split
    const topItems: SoupEntityActionItem[] = [];

    // Also what the reminder's own mark-done advances on, further down.
    const marksDoneOnThisView = viewContext.supportsMarkDone;

    if (marksDoneOnThisView) {
      // A fully-done selection (e.g. archived threads in mail "All") gets the
      // reverse action; anything else gets Mark Done.
      if (canExecuteAll(markNotDone.canExecute)) {
        topItems.push({
          id: 'mark-not-done',
          label: t('entityActions.markNotDone'),
          hotkeyToken: TOKENS.entity.action.markNotDone,
          onClick: handle(markNotDone.executeWithSoup),
        });
      } else if (canExecuteAll(markDone.canExecute)) {
        topItems.push({
          id: 'mark-done',
          label: t('entityActions.markDone'),
          hotkeyToken: TOKENS.entity.action.markDone,
          onClick: () =>
            markDone.executeWithSoup(
              entities,
              soup,
              createActionNavigationHandler?.()
            ),
        });
      }
    }

    // Email selections keep their thread read-state toggle. Other entities
    // can mark their attached notifications read; that action skips entities
    // and notifications that are already read.
    if (canExecuteAll(markUnread.canExecute)) {
      topItems.push({
        id: 'mark-unread',
        label: t('entityActions.markUnread'),
        hotkeyToken: TOKENS.entity.action.markUnread,
        onClick: handle(markUnread.executeWithSoup),
      });
    } else if (
      entities.every((e) => e.type === 'email') &&
      entities.some(markRead.canExecute)
    ) {
      topItems.push({
        id: 'mark-read',
        label: t('entityActions.markRead'),
        hotkeyToken: TOKENS.entity.action.markRead,
        onClick: handle(markRead.executeWithSoup),
      });
    } else if (
      entities.every((entity) => entity.type !== 'email') &&
      entities.some(markNotificationsRead.canExecute)
    ) {
      topItems.push({
        id: 'mark-notifications-read',
        label: t('entityActions.markRead'),
        onClick: handle(markNotificationsRead.executeWithSoup),
      });
    }

    /**
     * The single entity these open actions apply to, if any.
     *
     * Content already mounted in another split is skipped — reopening it would
     * duplicate it.
     */
    const openableEntity = (): EntityData | undefined => {
      if (isMobile()) return undefined;
      if (entities.length !== 1) return undefined;
      const entity = entities[0];
      // TODO(dev-rb/github): Allow GitHub PRs once they map to /pr.
      if (!entity || entity.type === 'foreign') return undefined;
      const splitManager = globalSplitManager();
      if (!splitManager) return undefined;
      // Reminder route claims perform identity reuse when the action runs.
      const contentId =
        entity.type === 'channel_message' || entity.type === 'channel_thread'
          ? entity.channelId
          : entity.id;
      const contentType = itemToBlockName(entity);
      const existing = splitManager.getSplitByContent(contentType, contentId);
      if (existing) return undefined;
      return entity;
    };

    const openEntity = (options: { openInNewSplit?: boolean }) => async () => {
      const entity = openableEntity();
      if (!entity) return;

      if (options.openInNewSplit) {
        analytics.track('split_created', {
          from: 'soup_view_entity_actions_menu',
        });
      }

      markCalendarNotificationSeenOnOpen(entity, notificationSource);

      // Match row navigation, including a thread row's driving message.
      await openEntityInSplitFromUnifiedList(entity, {
        ...options,
        splitHandle,
        referredFrom: 'entity-actions-menu',
        notificationSource,
      });
    };

    if (viewContext.supportsOpenInNewSplit && openableEntity()) {
      topItems.push({
        id: 'open-in-split',
        label: t('entityActions.openInNewSplit'),
        shortcut: 'shift+enter',
        // A layout with no room for another split cannot honor this: the open
        // would fall back to replacing a split instead of adding one.
        disabled: !globalSplitManager()?.canAppendSplit(),
        onClick: openEntity({ openInNewSplit: true }),
      });
    }

    // Middle group: Rename, Move to folder, Duplicate, Copy Link, Copy Branch Name, Share
    const middleItems: SoupEntityActionItem[] = [];

    if (canExecuteAll(renameAction.canExecute)) {
      middleItems.push({
        id: 'rename',
        label: t('entityActions.rename'),
        hotkeyToken: TOKENS.entity.action.rename,
        onClick: handle(renameAction.executeWithSoup),
      });
    }

    // Sits with Rename because it edits the same channel identity, under the
    // same participant rule. Single-entity only: one upload, one channel.
    if (entities.length === 1 && channelPictureAction.canExecute(entities[0])) {
      middleItems.push({
        id: 'set-channel-picture',
        label: t('entityActions.setChannelPicture'),
        onClick: () => channelPictureAction.execute(entities),
      });
      if (channelPictureAction.hasPicture(entities[0])) {
        middleItems.push({
          id: 'remove-channel-picture',
          label: t('entityActions.removeChannelPicture'),
          onClick: () => channelPictureAction.remove(entities),
        });
      }
    }

    if (canExecuteAll(favoriteAction.canExecute)) {
      const allFavorited = entities.every((entity) =>
        favoriteAction.isFavorited(entity)
      );
      // No icon: the other items in this menu don't have one.
      middleItems.push({
        id: 'favorite',
        label: allFavorited
          ? t('entityActions.unfavorite')
          : t('entityActions.favorite'),
        hotkeyToken: TOKENS.entity.action.favorite,
        onClick: handle(favoriteAction.executeWithSoup),
      });
    }

    if (canExecuteAll(muteAction.canExecute)) {
      middleItems.push({
        id: 'snooze',
        label: t('entityActions.snoozeNotifications'),
        onClick: () => muteAction.snooze(entities),
      });
      const allMuted = entities.every((entity) => muteAction.isMuted(entity));
      middleItems.push({
        id: 'mute',
        label: allMuted
          ? t('entityActions.unmuteNotifications')
          : t('entityActions.muteNotifications'),
        onClick: handle(muteAction.executeWithSoup),
      });
    }

    // Single-entity only: a reminder points at one thing.
    if (entities.length === 1 && createReminderAction.canExecute(entities[0])) {
      middleItems.push({
        id: 'create-reminder',
        label: t('entityActions.remindMe'),
        hotkeyToken: TOKENS.entity.action.createReminder,
        // Not `handle`: the mark-done that follows needs this view's answer to
        // whether the list moves on, the same one Mark Done above is gated by.
        onClick: () => {
          const onNavigate = createActionNavigationHandler?.();
          return createReminderAction.executeWithSoup(entities, soup, {
            advances: marksDoneOnThisView,
            onNavigate,
          });
        },
      });
    }

    if (entities.length === 1 && openTagPicker) {
      middleItems.push({
        id: 'add-tag',
        label: t('entityActions.addTag'),
        onClick: openTagPicker,
      });
    }

    if (
      projectsFlag().enabled &&
      openProjectPicker &&
      canExecuteAll(isTaskEntity)
    ) {
      middleItems.push({
        id: 'set-initiative',
        label: t('entityActions.addToProject'),
        onClick: () => {
          if (isFeatureEnabled(enableProjects)) openProjectPicker();
        },
      });
    }

    if (canExecuteAll(moveToProjectAction.canExecute)) {
      middleItems.push({
        id: 'move-to-folder',
        label: t('entityActions.moveToFolder'),
        hotkeyToken: TOKENS.entity.action.moveToFolder,
        onClick: handle(moveToProjectAction.executeWithSoup),
      });
    }

    if (viewedProjectId && canExecuteAll(removeFromProjectAction.canExecute)) {
      middleItems.push({
        id: 'remove-from-folder',
        label: t('entityActions.removeFromFolder'),
        onClick: handle(removeFromProjectAction.executeWithSoup),
      });
    }

    if (canExecuteAll(copyAction.canExecute)) {
      middleItems.push({
        id: 'duplicate',
        label: t('entityActions.duplicate'),
        hotkeyToken: TOKENS.entity.action.copy,
        onClick: handle(copyAction.executeWithSoup),
      });
    }

    if (entities.length === 1) {
      if (copyLinkAction.canExecute(entities[0])) {
        middleItems.push({
          id: 'copy-link',
          label: t('entityActions.copyLink'),
          hotkeyToken: TOKENS.entity.action.copyLink,
          onClick: handle(copyLinkAction.executeWithSoup),
        });
      }

      if (copyBranchNameAction.canExecute(entities[0])) {
        middleItems.push({
          id: 'copy-branch-name',
          label: t('entityActions.copyBranchName'),
          hotkeyToken: TOKENS.entity.action.copyBranchName,
          onClick: handle(copyBranchNameAction.executeWithSoup),
        });
      }

      middleItems.push({
        id: 'copy-entity-id',
        label: t('entityActions.copyId'),
        onClick: handle(copyEntityIdAction.executeWithSoup),
      });

      if (shareAction.canExecute(entities[0])) {
        middleItems.push({
          id: 'share',
          label: t('entityActions.share'),
          onClick: handle(shareAction.executeWithSoup),
        });
      }
    }

    // Sender group: Sender → Signal, Sender → Noise, Block Sender
    const senderItems: SoupEntityActionItem[] = [];

    if (
      viewContext.senderBucket === 'noise' &&
      canExecuteAll(markSenderSignalAction.canExecute)
    ) {
      senderItems.push({
        id: 'sender-signal',
        label: t('entityActions.senderToSignal'),
        onClick: handle(markSenderSignalAction.executeWithSoup),
      });
    }

    if (
      viewContext.senderBucket === 'signal' &&
      canExecuteAll(markSenderNoiseAction.canExecute)
    ) {
      senderItems.push({
        id: 'sender-noise',
        label: t('entityActions.senderToNoise'),
        onClick: handle(markSenderNoiseAction.executeWithSoup),
      });
    }

    if (canExecuteAll(blockSenderAction.canExecute)) {
      senderItems.push({
        id: 'block-sender',
        label: t('entityActions.blockSender'),
        onClick: handle(blockSenderAction.executeWithSoup),
      });
    }

    const crmItems = crmActions(entities, soup);

    // Delete group
    const deleteItems: SoupEntityActionItem[] = [];

    if (canExecuteAll(deleteAction.canExecute)) {
      deleteItems.push({
        id: 'delete',
        label: t('entityActions.delete'),
        hotkeyToken: entities.every(isEmailEntity)
          ? TOKENS.email.trash
          : TOKENS.entity.action.delete,
        onClick: handle(deleteAction.executeWithSoup),
        destructive: true,
      });
    }

    return [topItems, middleItems, senderItems, crmItems, deleteItems]
      .filter((items) => items.length > 0)
      .map((items) => ({ items }));
  };

  return { buildActionGroups, isFavorited: favoriteAction.isFavorited };
}
