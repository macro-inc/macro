import {
  type EntityActionListState,
  type EntityActionViewContext,
  makeBlockSenderAction,
  makeCopyAction,
  makeCopyBranchNameAction,
  makeCopyEntityIdAction,
  makeCopyLinkAction,
  makeCreateReminderAction,
  makeDeleteAction,
  makeEditReminderAction,
  makeFavoriteAction,
  makeHideCompanyAction,
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
  makeSetCompanyPropertyAction,
  makeShareAction,
  markReminderTargetDone,
} from '@app/features/next-soup/actions';
import {
  markReminderSeenOnOpen,
  openEntityInSplitFromUnifiedList,
} from '@app/features/next-soup/utils';
import { useAnalytics } from '@app/lib/analytics/analytics-context';
import { globalSplitManager } from '@app/signal/splitLayout';
import { useGlobalNotificationSource } from '@components/app/GlobalAppState';
import type { SplitHandle } from '@components/app/split-layout/layoutManager';
import { itemToBlockName } from '@core/constant/allBlocks';
import { useUserId } from '@core/context/user';
import { type HotkeyToken, TOKENS } from '@core/hotkey/tokens';
import { isMobile } from '@core/mobile/isMobile';
import type { EntityData } from '@entity';
import { useSetCompanyHiddenMutation } from '@queries/crm/companies';
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
    /**
     * The split hosting the list. Open actions route through it so they match
     * their click/hotkey equivalents, including Preview Pair routing.
     */
    splitHandle?: SplitHandle;
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
  // Setting a reminder puts the row down: it marks it done, so the list drops
  // it and the reminder is what brings it back.
  const createReminderAction = makeCreateReminderAction({
    onCreated: markReminderTargetDone(markDone),
  });
  const editReminderAction = makeEditReminderAction();
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
    { viewContext, viewedProjectId, openTagPicker, splitHandle }
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
          label: 'Mark Not Done',
          hotkeyToken: TOKENS.entity.action.markNotDone,
          onClick: handle(markNotDone.executeWithSoup),
        });
      } else if (canExecuteAll(markDone.canExecute)) {
        topItems.push({
          id: 'mark-done',
          label: 'Mark Done',
          hotkeyToken: TOKENS.entity.action.markDone,
          onClick: handle(markDone.executeWithSoup),
        });
      }
    }

    // Email selections keep their thread read-state toggle. Other entities
    // can mark their attached notifications read; that action skips entities
    // and notifications that are already read.
    if (canExecuteAll(markUnread.canExecute)) {
      topItems.push({
        id: 'mark-unread',
        label: 'Mark Unread',
        hotkeyToken: TOKENS.entity.action.markUnread,
        onClick: handle(markUnread.executeWithSoup),
      });
    } else if (
      entities.every((e) => e.type === 'email') &&
      entities.some(markRead.canExecute)
    ) {
      topItems.push({
        id: 'mark-read',
        label: 'Mark Read',
        hotkeyToken: TOKENS.entity.action.markRead,
        onClick: handle(markRead.executeWithSoup),
      });
    } else if (
      entities.every((entity) => entity.type !== 'email') &&
      entities.some(markNotificationsRead.canExecute)
    ) {
      topItems.push({
        id: 'mark-notifications-read',
        label: 'Mark Read',
        onClick: handle(markNotificationsRead.executeWithSoup),
      });
    }

    /**
     * The single entity these open actions apply to, if any.
     *
     * Content already mounted in another split is skipped — reopening it would
     * duplicate it. The Preview Pair's own Viewer is the exception: its copy is
     * the preview of this very row, which opening supersedes rather than
     * duplicates, so the row keeps its open actions while it is being
     * previewed.
     */
    const openableEntity = (): EntityData | undefined => {
      if (isMobile()) return undefined;
      if (entities.length !== 1) return undefined;
      const entity = entities[0];
      // TODO(dev-rb/github): Allow GitHub PRs once they map to /pr.
      if (!entity || entity.type === 'foreign') return undefined;
      const splitManager = globalSplitManager();
      if (!splitManager) return undefined;
      // A reminder opens its own editor — a `reminder-view` component split —
      // not what it references, so a standalone reminder is openable too and
      // the dedup check is against that editor split, not the reference.
      if (entity.type === 'reminder') {
        const open = splitManager.getSplitByContent(
          'component',
          `reminder-view~${entity.id}`
        );
        if (open && open.id !== splitHandle?.viewerId()) return undefined;
        return entity;
      }
      const contentId =
        entity.type === 'channel_message' || entity.type === 'channel_thread'
          ? entity.channelId
          : entity.id;
      const contentType = itemToBlockName(entity);
      const existing = splitManager.getSplitByContent(contentType, contentId);
      if (existing && existing.id !== splitHandle?.viewerId()) return undefined;
      return entity;
    };

    const openEntity =
      (options: { openInNewSplit?: boolean; replacePreview?: boolean }) =>
      async () => {
        const entity = openableEntity();
        if (!entity) return;

        if (options.openInNewSplit) {
          analytics.track('split_created', {
            from: 'soup_view_entity_actions_menu',
          });
        }

        markReminderSeenOnOpen(entity, notificationSource);

        // Same path as shift/opt+click, so the menu inherits Preview Pair
        // routing (new split when it fits; replacing the pair outright) and
        // per-entity targeting such as a thread row's driving message.
        await openEntityInSplitFromUnifiedList(entity, {
          ...options,
          splitHandle,
          referredFrom: 'entity-actions-menu',
          notificationSource,
        });
      };

    if (openableEntity()) {
      topItems.push({
        id: 'open-in-split',
        label: 'Open in new split',
        shortcut: 'shift+enter',
        // A layout with no room for another split cannot honor this: the open
        // would fall back to replacing a split instead of adding one.
        disabled: !globalSplitManager()?.canAppendSplit(),
        onClick: openEntity({ openInNewSplit: true }),
      });

      if (splitHandle?.isControllerSplit()) {
        topItems.push({
          id: 'open-to-replace-preview',
          label: 'Open to replace preview',
          shortcut: 'opt+enter',
          onClick: openEntity({ replacePreview: true }),
        });
      }
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

    // Takes Rename's slot, and its 'r' key. The two cannot both appear:
    // `renameAction.canExecute` ends at `entity.ownerId === userId()`, and a
    // reminder row's `ownerId` is always `''` (both soup mappers set it — a
    // reminder is private to its owner, so the row carries no owner id) while
    // `userId()` is a macro id or undefined. Renaming one would fail anyway;
    // its name is its description, which only the reminders API can change.
    // Single-entity only: the editor asks about one reminder's time.
    if (entities.length === 1 && editReminderAction.canExecute(entities[0])) {
      middleItems.push({
        id: 'edit-reminder',
        label: 'Edit reminder',
        hotkeyToken: TOKENS.entity.action.rename,
        onClick: handle(editReminderAction.executeWithSoup),
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

    if (canExecuteAll(muteAction.canExecute)) {
      const allMuted = entities.every((entity) => muteAction.isMuted(entity));
      middleItems.push({
        id: 'mute',
        label: allMuted ? 'Unmute notifications' : 'Mute notifications',
        onClick: handle(muteAction.executeWithSoup),
      });
    }

    // Single-entity only: a reminder points at one thing.
    if (entities.length === 1 && createReminderAction.canExecute(entities[0])) {
      middleItems.push({
        id: 'create-reminder',
        label: 'Remind me',
        hotkeyToken: TOKENS.entity.action.createReminder,
        // Not `handle`: the mark-done that follows needs this view's answer to
        // whether the list moves on, the same one Mark Done above is gated by.
        onClick: () =>
          createReminderAction.executeWithSoup(entities, soup, {
            advances: marksDoneOnThisView,
          }),
      });
    }

    if (entities.length === 1 && openTagPicker) {
      middleItems.push({
        id: 'add-tag',
        label: 'Add tag',
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
      if (copyLinkAction.canExecute(entities[0])) {
        middleItems.push({
          id: 'copy-link',
          label: 'Copy Link',
          hotkeyToken: TOKENS.entity.action.copyLink,
          onClick: handle(copyLinkAction.executeWithSoup),
        });
      }

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
      viewContext.senderBucket === 'noise' &&
      canExecuteAll(markSenderSignalAction.canExecute)
    ) {
      senderItems.push({
        id: 'sender-signal',
        label: 'Sender → Signal',
        onClick: handle(markSenderSignalAction.executeWithSoup),
      });
    }

    if (
      viewContext.senderBucket === 'signal' &&
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
