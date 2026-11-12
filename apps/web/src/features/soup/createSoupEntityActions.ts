import { createCrmEntityActionItems } from '@app/features/crm/crm-action-items';
import {
  type EntityActionListState,
  type EntityActionNavigationHandler,
  type EntityActionViewContext,
  emailSenderBucket,
  makeArchiveSessionAction,
  makeBlockSenderAction,
  makeChannelPictureAction,
  makeCopyAction,
  makeCopyBranchNameAction,
  makeCopyEntityIdAction,
  makeCopyLinkAction,
  makeCreateReminderAction,
  makeDeleteAction,
  makeDownloadAction,
  makeFavoriteAction,
  makeGithubLinkAction,
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
  openEntityInSplitFromUnifiedList,
  restoreSoupFocus,
} from '@app/features/next-soup/utils';
import { openProjectEntityAction } from '@app/features/projects/project-entity-actions';
import { useAllProperties } from '@app/features/property/editor/hooks/useAllProperties';
import { openPropertyEditor } from '@app/features/property/editor/state/propertyEditor';
import { useAnalytics } from '@app/lib/analytics/analytics-context';
import { useFeatureFlag } from '@app/lib/analytics/posthog';
import { t } from '@app/lib/i18n';
import { globalSplitManager } from '@app/signal/splitLayout';
import { useGlobalNotificationSource } from '@components/app/GlobalAppState';
import type { SplitHandle } from '@components/app/split-layout/layoutManager';
import {
  canOpenInNewTab,
  openInNewTab,
} from '@components/app/tab-layout/open-in-new-tab';
import { itemToBlockName } from '@core/constant/allBlocks';
import {
  enableEntityAppearance,
  enableProjects,
  isFeatureEnabled,
} from '@core/constant/featureFlags';
import { useUserId } from '@core/context/user';
import { type HotkeyToken, TOKENS } from '@core/hotkey/tokens';
import { isMobile } from '@core/mobile/isMobile';
import { fireAndForget } from '@core/util/fireAndForget';
import type { EntityData } from '@entity';
import { isEmailEntity, isGithubPrEntity, isTaskEntity } from '@entity';
import ShareIcon from '@icon/share.svg';
import ArchiveIcon from '@icon/system/regular/archive.svg';
import ArrowCounterClockwiseIcon from '@icon/system/regular/arrow-counter-clockwise.svg';
import ArrowSquareOutIcon from '@icon/system/regular/arrow-square-out.svg';
import BellIcon from '@icon/system/regular/bell-simple.svg';
import CheckCircleIcon from '@icon/system/regular/check-circle.svg';
import SplitIcon from '@icon/system/regular/columns.svg';
import CopyIcon from '@icon/system/regular/copy.svg';
import CubeIcon from '@icon/system/regular/cube.svg';
import DownloadIcon from '@icon/system/regular/download-simple.svg';
import EnvelopeIcon from '@icon/system/regular/envelope.svg';
import EnvelopeOpenIcon from '@icon/system/regular/envelope-open.svg';
import FlagIcon from '@icon/system/regular/flag.svg';
import FolderIcon from '@icon/system/regular/folder.svg';
import GitBranchIcon from '@icon/system/regular/git-branch.svg';
import ImageIcon from '@icon/system/regular/image.svg';
import LinkIcon from '@icon/system/regular/link.svg';
import PaintBrushIcon from '@icon/system/regular/paint-brush.svg';
import PencilIcon from '@icon/system/regular/pencil-line.svg';
import ProhibitIcon from '@icon/system/regular/prohibit.svg';
import StarIcon from '@icon/system/regular/star.svg';
import TagIcon from '@icon/system/regular/tag.svg';
import TrashIcon from '@icon/system/regular/trash-simple.svg';
import UserIcon from '@icon/system/regular/user.svg';
import type { NotificationMuteMenuProps } from '@notifications/components/NotificationMuteMenu';
import { markRowNotificationsSeenOnOpen } from '@notifications/mark-row-seen';
import { SYSTEM_PROPERTY_IDS } from '@property/constants';
import { useIsTeamAdmin } from '@queries/team/teams';
import type { Component, JSX } from 'solid-js';
import { supportsEntityAppearance } from '../entity-appearance/core/appearance';
import { useChangeEntityIcon } from '../entity-appearance/entity-appearance';
import { useAppearanceEditAccess } from '../entity-appearance/queries/access';

export type SoupEntityActionItem = {
  id: string;
  label: string;
  icon?: Component<JSX.SvgSVGAttributes<SVGSVGElement>>;
  hotkeyToken?: HotkeyToken;
  shortcut?: string;
  onClick: () => void | Promise<unknown>;
  /** Clipboard actions keep the menu open and acknowledge success inline. */
  copy?: boolean;
  destructive?: boolean;
  disabled?: boolean;
  muteMenu?: NotificationMuteMenuProps;
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
    selectedEntities?: () => readonly EntityData[];
  } = {}
): {
  buildActionGroups: BuildActionGroups;
  isFavorited: (entity: EntityData) => boolean;
} {
  const analytics = useAnalytics();
  const projectsFlag = useFeatureFlag(enableProjects);
  const appearanceFlag = useFeatureFlag(enableEntityAppearance);
  const userId = useUserId();
  const changeIcon = useChangeEntityIcon();
  const selectedEntity = () => {
    const entities = options.selectedEntities?.();
    return entities?.length === 1 ? entities[0] : undefined;
  };
  const canEditIcon = useAppearanceEditAccess(selectedEntity, userId);
  const isTeamAdmin = useIsTeamAdmin();
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
    isTeamAdmin,
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
  const moveToProjectAction = makeMoveToProjectAction({
    userId: () => userId(),
  });
  const removeFromProjectAction = makeRemoveFromProjectAction();
  const copyLinkAction = makeCopyLinkAction({ silent: true });
  const copyBranchNameAction = makeCopyBranchNameAction({ silent: true });
  const copyEntityIdAction = makeCopyEntityIdAction({ silent: true });
  const createReminderAction = makeCreateReminderAction();
  const shareAction = makeShareAction();
  const blockSenderAction = makeBlockSenderAction();
  const archiveSessionAction = makeArchiveSessionAction({
    userId: () => userId(),
  });
  const githubLinkAction = makeGithubLinkAction({ silent: true });
  const downloadAction = makeDownloadAction();
  const allProperties = useAllProperties();
  const taskProperty = (propertyId: string) =>
    allProperties().find(({ id }) => id === propertyId);
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

    // Projects act through the Projects view's dialogs. Rows carry no access
    // level, so rename and delete wait for ownership, which allows both.
    const projectIds =
      projectsFlag().enabled &&
      canExecuteAll((entity) => entity.type === 'initiative')
        ? entities.map((entity) => entity.id)
        : [];
    const ownsProjects =
      projectIds.length > 0 &&
      entities.every((entity) => entity.ownerId === userId());
    const singleProject = projectIds.length === 1 ? entities[0] : undefined;

    const handle =
      (
        execute: (
          entities: EntityData[],
          soup: EntityActionListState
        ) => Promise<unknown>
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
          icon: ArrowCounterClockwiseIcon,
          label: t('entityActions.markNotDone'),
          hotkeyToken: TOKENS.entity.action.markNotDone,
          onClick: handle(markNotDone.executeWithSoup),
        });
      } else if (canExecuteAll(markDone.canExecute)) {
        topItems.push({
          id: 'mark-done',
          icon: CheckCircleIcon,
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
        icon: EnvelopeIcon,
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
        icon: EnvelopeOpenIcon,
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
        icon: EnvelopeOpenIcon,
        label: t('entityActions.markRead'),
        onClick: handle(markNotificationsRead.executeWithSoup),
      });
    }

    /** Same-tab split deduplication must not prevent opening another tab. */
    const openableEntity = (
      destination: 'split' | 'tab'
    ): EntityData | undefined => {
      if (isMobile()) return undefined;
      if (entities.length !== 1) return undefined;
      const entity = entities[0];
      if (!entity) return undefined;
      // Pull requests open their Reviews detail; other foreign rows don't open.
      if (entity.type === 'foreign' && !isGithubPrEntity(entity))
        return undefined;
      const splitManager = globalSplitManager();
      if (!splitManager) return undefined;
      if (destination === 'split') {
        // Reminder route claims perform identity reuse when the action runs.
        const contentId =
          entity.type === 'channel_message' || entity.type === 'channel_thread'
            ? entity.channelId
            : entity.id;
        const contentType = itemToBlockName(entity);
        if (splitManager.getSplitByContent(contentType, contentId))
          return undefined;
      }
      return entity;
    };

    const openEntity = (destination: 'split' | 'tab') => async () => {
      const entity = openableEntity(destination);
      if (!entity) return;

      if (destination === 'split') {
        analytics.track('split_created', {
          from: 'soup_view_entity_actions_menu',
        });
      }

      markRowNotificationsSeenOnOpen(entity, notificationSource);

      // Match row navigation, including a thread row's driving message.
      await openEntityInSplitFromUnifiedList(entity, {
        openInNewSplit: destination === 'split',
        splitHandle,
        referredFrom: 'entity-actions-menu',
        notificationSource,
        channelNavigation: viewContext.channelNavigation,
        channelReadScope: viewContext.channelReadScope,
      });
    };

    if (viewContext.supportsOpenInNewSplit) {
      if (openableEntity('split')) {
        topItems.push({
          id: 'open-in-split',
          icon: SplitIcon,
          label: t('entityActions.openInNewSplit'),
          shortcut: 'shift+enter',
          // A layout with no room for another split cannot honor this: the open
          // would fall back to replacing a split instead of adding one.
          disabled: !globalSplitManager()?.canAppendSplit(),
          onClick: openEntity('split'),
        });
      }
      if (canOpenInNewTab() && openableEntity('tab')) {
        const open = openEntity('tab');
        topItems.push({
          id: 'open-in-tab',
          icon: ArrowSquareOutIcon,
          label: t('entityActions.openInNewTab'),
          onClick: () => openInNewTab(open),
        });
      }
    }

    // Middle group: Rename, Archive, Set status/priority/assignee, Move to
    // folder, Duplicate, Copy Link, Copy Branch Name, Copy ID, GitHub, Share
    const middleItems: SoupEntityActionItem[] = [];

    if (canExecuteAll(renameAction.canExecute)) {
      middleItems.push({
        id: 'rename',
        icon: PencilIcon,
        label: t('entityActions.rename'),
        hotkeyToken: TOKENS.entity.action.rename,
        onClick: handle(renameAction.executeWithSoup),
      });
    } else if (singleProject && ownsProjects) {
      middleItems.push({
        id: 'rename',
        icon: PencilIcon,
        label: t('entityActions.rename'),
        onClick: () => {
          openProjectEntityAction({
            kind: 'rename',
            id: singleProject.id,
            name: singleProject.name,
          });
        },
      });
    }
    const entity = entities.length === 1 ? entities[0] : undefined;
    if (
      appearanceFlag().enabled &&
      entity &&
      supportsEntityAppearance(entity) &&
      (entity.ownerId === userId() ||
        (selectedEntity()?.id === entity.id && canEditIcon()))
    ) {
      middleItems.push({
        id: 'change-icon',
        icon: PaintBrushIcon,
        label: t('appearance.title'),
        onClick: () => {
          changeIcon(entity);
        },
      });
    }

    if (entities.length === 1 && archiveSessionAction.canExecute(entities[0])) {
      middleItems.push({
        id: 'archive-session',
        icon: ArchiveIcon,
        label: archiveSessionAction.isArchived(entities[0])
          ? t('entityActions.unarchive')
          : t('entityActions.archive'),
        onClick: () => archiveSessionAction.execute(entities),
      });
    }

    // Sits with Rename because it edits the same channel identity, under the
    // same participant rule. Single-entity only: one upload, one channel.
    if (entities.length === 1 && channelPictureAction.canExecute(entities[0])) {
      middleItems.push({
        id: 'set-channel-picture',
        icon: ImageIcon,
        label: t('entityActions.setChannelPicture'),
        onClick: () => channelPictureAction.execute(entities),
      });
      if (channelPictureAction.hasPicture(entities[0])) {
        middleItems.push({
          id: 'remove-channel-picture',
          icon: ImageIcon,
          label: t('entityActions.removeChannelPicture'),
          onClick: () => channelPictureAction.remove(entities),
        });
      }
    }

    if (canExecuteAll(favoriteAction.canExecute)) {
      const allFavorited = entities.every((entity) =>
        favoriteAction.isFavorited(entity)
      );
      middleItems.push({
        id: 'favorite',
        icon: StarIcon,
        label: allFavorited
          ? t('entityActions.unfavorite')
          : t('entityActions.favorite'),
        hotkeyToken: TOKENS.entity.action.favorite,
        onClick: handle(favoriteAction.executeWithSoup),
      });
    }

    if (canExecuteAll(muteAction.canExecute)) {
      const allMuted = entities.every((entity) => muteAction.isMuted(entity));
      middleItems.push({
        id: 'mute',
        icon: BellIcon,
        label: allMuted
          ? t('entityActions.unmuteNotifications')
          : t('entityActions.muteNotifications'),
        onClick: handle(muteAction.executeWithSoup),
        muteMenu: muteAction.menu(entities),
      });
    }

    // Single-entity only: a reminder points at one thing.
    if (entities.length === 1 && createReminderAction.canExecute(entities[0])) {
      middleItems.push({
        id: 'create-reminder',
        icon: BellIcon,
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
        icon: TagIcon,
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
        icon: CubeIcon,
        label: t('entityActions.addToProject'),
        onClick: () => {
          if (isFeatureEnabled(enableProjects)) openProjectPicker();
        },
      });
    }

    // The task properties the hotkeys and command menu set, as the CRM group
    // below sets a company's.
    if (canExecuteAll(isTaskEntity)) {
      for (const [propertyId, label, hotkeyToken, icon] of [
        [
          SYSTEM_PROPERTY_IDS.STATUS,
          t('entityActions.setStatus'),
          TOKENS.entity.action.status,
          CheckCircleIcon,
        ],
        [
          SYSTEM_PROPERTY_IDS.PRIORITY,
          t('entityActions.setPriority'),
          TOKENS.entity.action.priority,
          FlagIcon,
        ],
        [
          SYSTEM_PROPERTY_IDS.ASSIGNEES,
          t('entityActions.setAssignee'),
          TOKENS.entity.action.assignee,
          UserIcon,
        ],
      ] as const) {
        const property = taskProperty(propertyId);
        if (!property) continue;
        middleItems.push({
          id: `set-${propertyId}`,
          icon,
          label,
          hotkeyToken,
          onClick: () =>
            openPropertyEditor(entities, 'direct', property, {
              restoreFocus: () =>
                fireAndForget(
                  restoreSoupFocus(entities[0]?.id),
                  'entity-actions'
                ),
            }),
        });
      }
    }

    if (canExecuteAll(moveToProjectAction.canExecute)) {
      middleItems.push({
        id: 'move-to-folder',
        icon: FolderIcon,
        label: t('entityActions.moveToFolder'),
        hotkeyToken: TOKENS.entity.action.moveToFolder,
        onClick: handle(moveToProjectAction.executeWithSoup),
      });
    }

    if (viewedProjectId && canExecuteAll(removeFromProjectAction.canExecute)) {
      middleItems.push({
        id: 'remove-from-folder',
        icon: FolderIcon,
        label: t('entityActions.removeFromFolder'),
        onClick: handle(removeFromProjectAction.executeWithSoup),
      });
    }

    if (canExecuteAll(copyAction.canExecute)) {
      middleItems.push({
        id: 'duplicate',
        icon: CopyIcon,
        label: t('entityActions.duplicate'),
        hotkeyToken: TOKENS.entity.action.copy,
        onClick: handle(copyAction.executeWithSoup),
      });
    }

    if (entities.length === 1) {
      if (copyLinkAction.canExecute(entities[0])) {
        middleItems.push({
          id: 'copy-link',
          icon: LinkIcon,
          copy: true,
          label: t('entityActions.copyLink'),
          hotkeyToken: TOKENS.entity.action.copyLink,
          onClick: handle(copyLinkAction.executeWithSoup),
        });
      }

      if (copyBranchNameAction.canExecute(entities[0])) {
        middleItems.push({
          id: 'copy-branch-name',
          icon: GitBranchIcon,
          copy: true,
          label: t('entityActions.copyBranchName'),
          hotkeyToken: TOKENS.entity.action.copyBranchName,
          onClick: handle(copyBranchNameAction.executeWithSoup),
        });
      }

      if (downloadAction.canExecute(entities[0])) {
        middleItems.push({
          id: 'download',
          icon: DownloadIcon,
          label: t('entityActions.download'),
          onClick: handle(downloadAction.executeWithSoup),
        });
      }

      if (copyEntityIdAction.canExecute(entities[0])) {
        middleItems.push({
          id: 'copy-entity-id',
          icon: CopyIcon,
          copy: true,
          label: t('entityActions.copyId'),
          onClick: handle(copyEntityIdAction.executeWithSoup),
        });
      }

      const entity = entities[0];
      if (githubLinkAction.canExecute(entity)) {
        middleItems.push(
          {
            id: 'copy-github-link',
            icon: LinkIcon,
            copy: true,
            label: t('entityActions.copyGithubLink'),
            onClick: () => githubLinkAction.copy(entity),
          },
          {
            id: 'open-on-github',
            icon: ArrowSquareOutIcon,
            label: t('entityActions.openOnGitHub'),
            onClick: () => githubLinkAction.open(entity),
          }
        );
      }
    }

    if (canExecuteAll(shareAction.canExecute)) {
      middleItems.push({
        id: 'share',
        icon: ShareIcon,
        label: t('entityActions.share'),
        onClick: handle(shareAction.executeWithSoup),
      });
    } else if (singleProject) {
      middleItems.push({
        id: 'share',
        icon: ShareIcon,
        label: t('entityActions.share'),
        onClick: () => {
          openProjectEntityAction({ kind: 'share', id: singleProject.id });
        },
      });
    }

    // Sender group: Sender → Signal, Sender → Noise, Block Sender
    const senderItems: SoupEntityActionItem[] = [];

    // Each email's own bucket decides, falling back to the view's tab; with
    // neither known (some Search rows), both moves are offered.
    const senderBucketOf = (entity: EntityData) =>
      emailSenderBucket(entity) ?? viewContext.senderBucket;

    if (
      canExecuteAll(markSenderSignalAction.canExecute) &&
      entities.some((entity) => senderBucketOf(entity) !== 'signal')
    ) {
      senderItems.push({
        id: 'sender-signal',
        icon: EnvelopeOpenIcon,
        label: t('entityActions.senderToSignal'),
        onClick: handle(markSenderSignalAction.executeWithSoup),
      });
    }

    if (
      canExecuteAll(markSenderNoiseAction.canExecute) &&
      entities.some((entity) => senderBucketOf(entity) !== 'noise')
    ) {
      senderItems.push({
        id: 'sender-noise',
        icon: BellIcon,
        label: t('entityActions.senderToNoise'),
        onClick: handle(markSenderNoiseAction.executeWithSoup),
      });
    }

    if (canExecuteAll(blockSenderAction.canExecute)) {
      senderItems.push({
        id: 'block-sender',
        icon: ProhibitIcon,
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
        icon: TrashIcon,
        label: t('entityActions.delete'),
        hotkeyToken: entities.every(isEmailEntity)
          ? TOKENS.email.trash
          : TOKENS.entity.action.delete,
        onClick: handle(deleteAction.executeWithSoup),
        destructive: true,
      });
    } else if (ownsProjects) {
      deleteItems.push({
        id: 'delete',
        icon: TrashIcon,
        label: t('entityActions.delete'),
        onClick: () => {
          // Like the other delete path, drop the selection once rows are
          // gone so later bulk actions don't target deleted projects.
          openProjectEntityAction(
            { kind: 'delete', ids: projectIds },
            { onDeleted: () => soup.selection.clear() }
          );
        },
        destructive: true,
      });
    }

    return [topItems, middleItems, senderItems, crmItems, deleteItems]
      .filter((items) => items.length > 0)
      .map((items) => ({ items }));
  };

  return { buildActionGroups, isFavorited: favoriteAction.isFavorited };
}
