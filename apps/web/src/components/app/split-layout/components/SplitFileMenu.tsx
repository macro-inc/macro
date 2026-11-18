import { openBulkEditModal } from '@app/features/entity/bulk-edit/BulkEditEntityModal';
import { toastMovedToFolder } from '@app/features/entity/bulk-edit/moved-to-folder-toast';
import { EntityAppearanceMenu } from '@app/features/entity-appearance/appearance-menu';
import { supportsEntityAppearance } from '@app/features/entity-appearance/core/appearance';
import { useChangeEntityIcon } from '@app/features/entity-appearance/entity-appearance';
import {
  makeAddTagAction,
  makeCopyEntityIdAction,
  makeCopyLinkAction,
  makeCreateReminderAction,
  makeFavoriteAction,
  makeMuteAction,
} from '@app/features/next-soup/actions';
import { ProjectAssignmentDialog } from '@app/features/projects/projects';
import { EntityTagSubmenu } from '@app/features/property/tags/EntityTagSubmenu';
import { useFeatureFlag } from '@app/lib/analytics/posthog';
import { t } from '@app/lib/i18n';
import type { BlockTool } from '@components/app/block-tool';
import { useGlobalNotificationSource } from '@components/app/GlobalAppState';
import {
  type BlockAlias,
  type BlockName,
  useBlockAliasedName,
} from '@core/block';
import { canDuplicateItemType } from '@core/component/FileList/itemOperations';
import { useItemOperations } from '@core/component/FileList/useItemOperations';
import { Permissions } from '@core/component/SharePermissions';
import { toast } from '@core/component/Toast/Toast';
import { resolveBlockAlias } from '@core/constant/allBlocks';
import {
  enableEntityAppearance,
  enableReminders,
} from '@core/constant/featureFlags';
import { useQuickAccess } from '@core/context/quickAccess';
import { triggerFocusInput } from '@core/directive/focusInput';
import { type HotkeyToken, TOKENS } from '@core/hotkey/tokens';
import { getActiveCommandByToken } from '@core/hotkey/utils';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import { useGetPermissions } from '@core/signal/permissions';
import { fireAndForget } from '@core/util/fireAndForget';
import { buildEntityData, type EntityData } from '@entity';
import BellSimple from '@icon/system/regular/bell-simple.svg';
import BellSlash from '@icon/system/regular/bell-slash.svg';
import Copy from '@icon/system/regular/copy.svg';
import ProjectIcon from '@icon/system/regular/cube.svg';
import FolderIcon from '@icon/system/regular/folder.svg';
import Link from '@icon/system/regular/link.svg';
import PaintBrush from '@icon/system/regular/paint-brush.svg';
import Rename from '@icon/system/regular/pencil-line.svg';
import Star from '@icon/system/regular/star.svg';
import Tag from '@icon/system/regular/tag.svg';
import Trash from '@icon/system/regular/trash-simple.svg';

import type { ItemType } from '@service-storage/itemType';
import {
  type Component,
  createEffect,
  createMemo,
  createSignal,
  type JSX,
  onCleanup,
  Show,
  useContext,
} from 'solid-js';
import { match } from 'ts-pattern';
import {
  type SplitFileMenuAction,
  type SplitFileMenuActionGroup,
  type SplitFileMenuActionGroups,
  SplitPanelContext,
} from '../context';
import { fileMenuGroups } from '../core/file-menu-groups';
import { useSplitLayout } from '../layout';
import { returnSplitToRecentListView } from '../layoutUtils';

import { DesktopFileMenu, MobileFileMenu } from './SplitFileMenuRenderers';

export type FileOperationName = 'delete' | 'rename' | 'copy' | 'moveToProject';

export type DefaultFileOperation = {
  op: FileOperationName;
};

export type CustomFileOperation = {
  label: string;
  icon: Component;
  action?: () => void | Promise<unknown>;
  copy?: boolean;
  children?: SplitFileMenuAction[];
  group?: SplitFileMenuActionGroup;
};

const isDefaultFileOperation = (
  op: FileOperation
): op is DefaultFileOperation => {
  return 'op' in op;
};

export type FileOperation = DefaultFileOperation | CustomFileOperation;

/**
 * A titled radio group leading the mobile drawer, mirroring which view (page)
 * of the block is open — for blocks whose inline view tabs have no room on
 * mobile (e.g. the channel's Messages/Attachments/Participants tabs).
 */
export type SplitFileMenuViews = {
  /** Section title shown above the radio group, e.g. 'View'. */
  title: string;
  options: Array<{
    value: string;
    label: string | JSX.Element;
    icon: Component;
  }>;
  value: string;
  onSelect: (value: string) => void;
};

export type SplitFileMenuProps = {
  onEmailReminderSaved?: () => void | Promise<void>;
  id: string;
  itemType: ItemType;
  name: string;
  formattedName?: string;
  ops: Array<FileOperation>;
  tools?: BlockTool[];
  /** See {@link SplitFileMenuViews}. Only the mobile drawer renders it. */
  mobileViews?: SplitFileMenuViews;
  /**
   * Full entity for the menu's entity-gated items. Supply it when the block
   * can build one that generic chrome can't reconstruct from id/name/entityKind
   * alone (e.g. calls need their channelId).
   */
  entity?: EntityData;
  buttonClass?: string;
  entityKind: BlockName | BlockAlias;
  permissions: Permissions;
  onDuplicate?: (id: string) => void;
  onDelete?: () => void;
};

export function SplitFileMenu(props: SplitFileMenuProps) {
  const ctx = useContext(SplitPanelContext);
  if (!ctx)
    throw new Error('<SplitFileMenu> must be used in <SplitPanelContext>');

  const blockName = resolveBlockAlias(props.entityKind);

  const [open, setOpen] = createSignal(false);
  const [assigningProject, setAssigningProject] = createSignal(false);
  const appearanceFlag = useFeatureFlag(enableEntityAppearance);
  const itemOperations = useItemOperations();
  const quickAccess = useQuickAccess();
  const favoriteAction = makeFavoriteAction();
  const notificationSource = useGlobalNotificationSource();
  const muteAction = makeMuteAction({
    notificationSource: () => notificationSource,
  });
  const createReminderAction = makeCreateReminderAction({
    onEmailSaved: props.onEmailReminderSaved,
  });
  const addTagAction = makeAddTagAction();
  const copyLinkAction = makeCopyLinkAction({ silent: true });
  const copyEntityIdAction = makeCopyEntityIdAction({ silent: true });
  const changeIcon = useChangeEntityIcon();
  // Read shortcut availability from row getters so focus changes update only
  // the hint, without recreating the action groups and losing menu focus.
  const activeHotkeyToken = (token: HotkeyToken): HotkeyToken | undefined => {
    return getActiveCommandByToken(token) ? token : undefined;
  };

  const { replaceOrInsertSplit } = useSplitLayout();

  // The entity this menu operates on: the block's own entity when supplied,
  // else the quick-access cache (richer data, covers channels/calls), else
  // built from the block's id/name/entityKind like the rename/move ops do.
  const menuEntity = createMemo<EntityData | undefined>(() => {
    if (props.entity) return props.entity;
    const item = quickAccess.getById(props.id);
    if (item?.kind === 'entity') return item.data;
    return buildEntityData({
      id: props.id,
      name: props.name,
      blockName: props.entityKind,
    });
  });
  const appearanceMenuItem = () => (
    <Show when={menuEntity()}>
      {(entity) => <EntityAppearanceMenu entity={entity()} />}
    </Show>
  );
  const tagMenuItem = (menu: {
    onActionComplete?: () => void;
    menu?: 'dropdown';
  }) => (
    <Show when={menuEntity()}>
      {(entity) => (
        <EntityTagSubmenu
          menu={menu.menu}
          entity={entity()}
          onActionComplete={menu.onActionComplete}
        />
      )}
    </Show>
  );

  const appearanceOp = (): SplitFileMenuAction | undefined => {
    const entity = menuEntity();
    if (
      !appearanceFlag().enabled ||
      !entity ||
      !supportsEntityAppearance(entity)
    )
      return;
    if (
      props.permissions !== Permissions.OWNER &&
      props.permissions !== Permissions.CAN_EDIT
    )
      return;
    return {
      label: t('appearance.title'),
      icon: PaintBrush,
      group: 'modify',
      id: 'appearance',
      menuItem: appearanceMenuItem,
      action: () => {
        setOpen(false);
        changeIcon(entity);
      },
    };
  };

  const favoriteOp = (): SplitFileMenuAction | undefined => {
    const entity = menuEntity();
    if (!entity || !favoriteAction.canExecute(entity)) return undefined;
    return {
      id: 'favorite',
      label: favoriteAction.isFavorited(entity)
        ? t('entityActions.unfavorite')
        : t('entityActions.favorite'),
      icon: Star,
      action: () => {
        fireAndForget(favoriteAction.execute([entity]), 'entity-actions');
      },
      get hotkeyToken() {
        return activeHotkeyToken(TOKENS.entity.action.favorite);
      },
      group: 'most-used' as const,
    };
  };

  const muteOp = (): SplitFileMenuAction | undefined => {
    const entity = menuEntity();
    if (!entity || !muteAction.canExecute(entity)) return undefined;
    const muted = muteAction.isMuted(entity);
    return {
      id: 'mute',
      label: muted
        ? t('entityActions.unmuteNotifications')
        : t('entityActions.muteNotifications'),
      icon: muted ? BellSimple : BellSlash,
      muteMenu: muteAction.menu([entity]),
      action: () => {
        fireAndForget(muteAction.execute([entity]), 'entity-actions');
      },
      get hotkeyToken() {
        return activeHotkeyToken(TOKENS.entity.action.mute);
      },
      group: 'state' as const,
    };
  };

  // Read reactively as well as through the action's imperative gate: `ops` below
  // is a memo, so without a reactive dependency the item would stay missing for
  // the life of this menu if PostHog answered after it was first computed. The
  // other reminder surfaces re-evaluate per interaction and don't need this.
  const remindersFlag = useFeatureFlag(enableReminders);

  // Offer the shared snooze command for email conversations.
  const reminderOp = (): SplitFileMenuAction | undefined => {
    if (!remindersFlag().enabled) return undefined;
    const entity = menuEntity();
    if (!entity || !createReminderAction.canExecute(entity)) return undefined;
    return {
      id: 'reminder',
      label: t('entityActions.remindMe'),
      icon: BellSimple,
      action: () => {
        setOpen(false);
        createReminderAction.execute([entity]);
      },
      get hotkeyToken() {
        return activeHotkeyToken(TOKENS.entity.action.createReminder);
      },
      group: 'most-used' as const,
    };
  };

  // Only offered when the block's entity type can be tagged.
  const addTagOp = (): SplitFileMenuAction | undefined => {
    const entity = menuEntity();
    if (!entity || !addTagAction.canExecute(entity)) return undefined;
    return {
      label: t('entityActions.addTag'),
      icon: Tag,
      id: 'add-tag',
      menuItem: tagMenuItem,
      action: () => {
        setOpen(false);
        addTagAction.execute([entity]);
      },
      get hotkeyToken() {
        return activeHotkeyToken(TOKENS.entity.action.tags);
      },
      group: 'modify' as const,
    };
  };

  const copyLinkOp = (): SplitFileMenuAction | undefined => {
    const entity = menuEntity();
    // Some entities have no shareable link (a reminder resolves to no block, so
    // its URL is dead); skip the item rather than copy one that won't open.
    if (entity && !copyLinkAction.canExecute(entity)) return undefined;
    return {
      id: 'copy-link',
      label: t('entityActions.copyLink'),
      icon: Link,
      copy: true,
      action: () =>
        entity
          ? copyLinkAction.execute([entity])
          : copyLinkAction.executeByBlock(props.id, props.entityKind),
      get hotkeyToken() {
        return activeHotkeyToken(TOKENS.entity.action.copyLink);
      },
      group: 'copy' as const,
    };
  };

  const copyEntityIdOp = (): SplitFileMenuAction => ({
    id: 'copy-id',
    label: t('entityActions.copyId'),
    icon: Copy,
    copy: true,
    action: () => copyEntityIdAction.executeById(props.id),
    get hotkeyToken() {
      return activeHotkeyToken(TOKENS.entity.action.copyEntityId);
    },
    group: 'copy' as const,
  });

  createEffect(() => {
    const openMenu = () => setOpen(true);
    ctx.setTitleFileMenuTrigger(() => openMenu);
    onCleanup(() => ctx.setTitleFileMenuTrigger(undefined));
  });

  const ownsMenuEntity = () => props.permissions === Permissions.OWNER;

  const ops = createMemo<SplitFileMenuAction[]>(() => {
    const mapped = props.ops
      .map((op) => {
        if (isDefaultFileOperation(op)) {
          return match(op.op)
            .returnType<SplitFileMenuAction | null>()
            .with('delete', () => {
              if (!ownsMenuEntity()) return null;
              return {
                id: 'delete',
                label: t('entityActions.delete'),
                action: () => {
                  const entity = menuEntity();
                  if (!entity) return;
                  setOpen(false);
                  openBulkEditModal({
                    view: 'delete',
                    entities: [entity],
                    onFinish: () => {
                      toast.success(t('entityActions.toastDeleted'));
                      if (props.onDelete) {
                        props.onDelete();
                      } else {
                        returnSplitToRecentListView(ctx.handle);
                      }
                    },
                    onError: () =>
                      toast.failure(t('entityActions.toastDeleteFailed')),
                  });
                },
                icon: Trash,
                group: 'delete' as const,
              };
            })
            .with('rename', () => {
              if (!ownsMenuEntity()) return null;
              return {
                id: 'rename',
                label: t('entityActions.rename'),
                action: () => {
                  const entity = menuEntity();
                  if (!entity) return;
                  setOpen(false);
                  openBulkEditModal({
                    view: 'rename',
                    entities: [entity],
                    onFinish: () =>
                      toast.success(t('entityActions.toastRenamed')),
                    onError: () =>
                      toast.failure(t('entityActions.toastRenameFailed')),
                  });
                },
                icon: Rename,
                get hotkeyToken() {
                  return activeHotkeyToken(TOKENS.entity.action.rename);
                },
                group: 'modify' as const,
              };
            })
            .with('copy', () => {
              if (!canDuplicateItemType(props.itemType)) return null;
              return {
                id: 'duplicate',
                label: t('entityActions.duplicate'),
                action: async () => {
                  const res = await itemOperations.copyItem({
                    itemType: props.itemType,
                    id: props.id,
                    name: props.name,
                  });
                  if (!res) return;
                  if (props.onDuplicate) {
                    props.onDuplicate(res);
                  } else {
                    replaceOrInsertSplit(
                      {
                        id: res,
                        type: blockName,
                      },
                      'entity-actions-menu'
                    );
                  }
                },
                icon: Copy,
                group: 'modify' as const,
              };
            })
            .with('moveToProject', () => {
              if (!ownsMenuEntity()) return null;
              return {
                id: 'move-to-folder',
                label: t('entityActions.moveToFolder'),
                action: () => {
                  const entity = menuEntity();
                  if (!entity) return;
                  setOpen(false);
                  openBulkEditModal({
                    view: 'moveToProject',
                    entities: [entity],
                    onMoved: (folder) => toastMovedToFolder(1, folder.id),
                    onError: () =>
                      toast.failure(t('entityActions.toastMoveToFolderFailed')),
                  });
                },
                icon: FolderIcon,
                get hotkeyToken() {
                  return activeHotkeyToken(TOKENS.entity.action.moveToFolder);
                },
                group: 'modify' as const,
              };
            })
            .exhaustive();
        } else {
          return op;
        }
      })
      .map((op, index): SplitFileMenuAction | null => {
        if (!op) return null;
        // Preserve live getters (notably hotkey availability) when assigning a key.
        const action: SplitFileMenuAction = Object.defineProperties(
          { label: op.label },
          Object.getOwnPropertyDescriptors(op)
        );
        action.id ??= `operation-${index}`;
        return action;
      })
      .filter((op) => !!op);
    const appearance = appearanceOp();
    if (appearance) {
      const renameIndex = mapped.findIndex((op) => op.icon === Rename);
      mapped.splice(
        renameIndex < 0 ? mapped.length : renameIndex + 1,
        0,
        appearance
      );
    }
    return [
      favoriteOp(),
      muteOp(),
      reminderOp(),
      addTagOp(),
      ...(props.entityKind === 'task' &&
      (props.permissions === Permissions.OWNER ||
        props.permissions === Permissions.CAN_EDIT)
        ? [
            {
              id: 'add-to-project',
              label: t('entityActions.addToProject'),
              icon: ProjectIcon,
              group: 'modify' as const,
              action: () => {
                setOpen(false);
                setAssigningProject(true);
              },
            },
          ]
        : []),
      copyLinkOp(),
      copyEntityIdOp(),
      ...mapped,
    ].filter((op) => !!op);
  });

  // Key each tool by its position before filtering: callers pass `tools` as
  // a JSX array, which every read of `props.tools` rebuilds, so looking a tool
  // up again by identity finds nothing and gives every row the same key.
  const filteredTools = createMemo(() =>
    (props.tools ?? [])
      .map((tool, index) => ({ tool, id: `tool-${index}` }))
      .filter(({ tool }) => !tool.condition || tool.condition())
  );

  const tools = createMemo<SplitFileMenuAction[]>(() =>
    filteredTools().map(({ tool, id }) => ({
      id,
      label: typeof tool.label === 'function' ? tool.label() : tool.label,
      disabledReason: tool.disabledReason,
      icon: tool.icon,
      children: tool.children,
      hotkeyToken: tool.hotkeyToken,
      group: tool.group,
      action: (e?: MouseEvent) => {
        tool.action();
        if (tool.focusTarget) {
          triggerFocusInput(
            tool.focusTarget,
            e?.currentTarget as HTMLElement | undefined
          );
        }
        setOpen(false);
      },
    }))
  );

  const actionGroups = createMemo<SplitFileMenuActionGroups>(() =>
    fileMenuGroups(tools(), ops())
  );

  createEffect(() => {
    ctx.setTitleFileMenuActions(actionGroups());
  });

  onCleanup(() => ctx.setTitleFileMenuActions(undefined));

  return (
    <>
      <Show
        when={isTouchDevice()}
        fallback={
          <DesktopFileMenu
            open={open()}
            onOpenChange={setOpen}
            triggerClass={props.buttonClass}
            groups={actionGroups()}
          />
        }
      >
        <MobileFileMenu
          open={open()}
          onOpenChange={setOpen}
          triggerClass={props.buttonClass}
          groups={actionGroups()}
          views={props.mobileViews}
        />
      </Show>
      <Show when={assigningProject()}>
        <ProjectAssignmentDialog
          taskIds={[props.id]}
          onClose={() => setAssigningProject(false)}
        />
      </Show>
    </>
  );
}

export type BlockSplitFileMenuProps = Omit<
  SplitFileMenuProps,
  'entityKind' | 'permissions'
> & { permissions?: Permissions };

/** Supplies legacy Block identity, permissions, and registered hotkeys. */
export function BlockSplitFileMenu(props: BlockSplitFileMenuProps) {
  const entityKind = useBlockAliasedName();
  const permissions = useGetPermissions();

  return (
    <SplitFileMenu
      {...props}
      entityKind={entityKind}
      permissions={props.permissions ?? permissions()}
    />
  );
}
