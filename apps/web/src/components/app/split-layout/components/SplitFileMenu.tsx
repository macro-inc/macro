import { openBulkEditModal } from '@app/features/entity/bulk-edit/BulkEditEntityModal';
import {
  makeAddTagAction,
  makeCopyEntityIdAction,
  makeCopyLinkAction,
  makeCreateReminderAction,
  makeFavoriteAction,
  makeMarkDoneAction,
  makeMuteAction,
  markReminderTargetDone,
} from '@app/features/next-soup/actions';
import { useFeatureFlag } from '@app/lib/analytics/posthog';
import { useGlobalNotificationSource } from '@components/app/GlobalAppState';
import { MobileDrawer } from '@components/app/mobile/MobileDrawer';
import type { BlockTool } from '@components/app/ResponsiveBlockToolbar';
import { type BlockName, useBlockAliasedName, useBlockName } from '@core/block';
import { useItemOperations } from '@core/component/FileList/useItemOperations';
import { toast } from '@core/component/Toast/Toast';
import { enableReminders } from '@core/constant/featureFlags';
import { useQuickAccess } from '@core/context/quickAccess';
import { useUserId } from '@core/context/user';
import { triggerFocusInput } from '@core/directive/focusInput';
import { type HotkeyToken, TOKENS } from '@core/hotkey/tokens';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import { useIsDocumentOwner } from '@core/signal/permissions';
import { buildEntityData, type EntityData } from '@entity';
import DotsThree from '@icon/dots-three-large.svg';
import ArrowRight from '@phosphor/arrow-right.svg';
import BellSimple from '@phosphor/bell-simple.svg';
import BellSlash from '@phosphor/bell-slash.svg';
import CaretDown from '@phosphor/caret-down.svg';
import CaretRight from '@phosphor/caret-right.svg';
import Check from '@phosphor/check.svg';
import Copy from '@phosphor/copy.svg';
import Link from '@phosphor/link.svg';
import Rename from '@phosphor/pencil-line.svg';
import Star from '@phosphor/star.svg';
import Tag from '@phosphor/tag.svg';
import Trash from '@phosphor/trash-simple.svg';
import { blockNameToItemType, type ItemType } from '@service-storage/itemType';
import { cn, Dropdown, Hotkey } from '@ui';
import {
  type Component,
  createEffect,
  createMemo,
  createSignal,
  For,
  type JSX,
  onCleanup,
  Show,
  useContext,
} from 'solid-js';
import { Dynamic } from 'solid-js/web';
import {
  getSplitFileMenuActionSections,
  type SplitFileMenuAction,
  type SplitFileMenuActionGroup,
  type SplitFileMenuActionGroups,
  SplitPanelContext,
} from '../context';
import { useSplitLayout } from '../layout';
import { returnSplitToRecentListView } from '../layoutUtils';

export type FileOperationName = 'delete' | 'rename' | 'copy' | 'moveToProject';

export type DefaultFileOperation = {
  op: FileOperationName;
};

export type CustomFileOperation = {
  label: string;
  icon: Component;
  action?: () => void;
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

/**
 * Blocks whose Block.tsx calls useBlockEntityCommands(), registering the
 * block-scoped shortcuts the generic ops advertise. Keep in sync with that
 * hook's callers.
 */
const BLOCKS_WITH_ENTITY_HOTKEYS: ReadonlySet<BlockName> = new Set<BlockName>([
  'canvas',
  'channel',
  'chat',
  'code',
  'email',
  'image',
  'md',
  'pdf',
  'project',
  'video',
]);

function SplitMenuItemContent(
  props: Pick<SplitFileMenuAction, 'hotkeyToken' | 'icon' | 'label'> & {
    showHotkey?: boolean;
  }
) {
  return (
    <>
      <Dynamic
        component={props.icon as Component<JSX.SvgSVGAttributes<SVGSVGElement>>}
        class="size-4 shrink-0"
      />
      <div class="flex-1 truncate">{props.label}</div>
      <Show when={props.showHotkey !== false && props.hotkeyToken}>
        <Hotkey
          token={props.hotkeyToken}
          class="ml-4 shrink-0"
          theme="subtle"
          showPlus
        />
      </Show>
    </>
  );
}

type SplitFileMenuRenderProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  triggerClass?: string;
  groups: SplitFileMenuActionGroups;
};

function DesktopRender(props: SplitFileMenuRenderProps) {
  const sections = () => getSplitFileMenuActionSections(props.groups);

  const item = (action: SplitFileMenuAction) => {
    const children = () => action.children?.filter(Boolean) ?? [];

    return (
      <Show
        when={children().length > 0}
        fallback={
          <Dropdown.Item
            onSelect={() => {
              action.action?.();
              props.onOpenChange(false);
            }}
          >
            <SplitMenuItemContent {...action} />
          </Dropdown.Item>
        }
      >
        <Dropdown.Sub>
          <Dropdown.SubTrigger>
            <SplitMenuItemContent {...action} />
            <CaretRight class="size-3.5 shrink-0" />
          </Dropdown.SubTrigger>
          <Dropdown.SubContent>
            <Dropdown.Group>
              <For each={children()}>{item}</For>
            </Dropdown.Group>
          </Dropdown.SubContent>
        </Dropdown.Sub>
      </Show>
    );
  };

  return (
    <Dropdown open={props.open} onOpenChange={props.onOpenChange}>
      <Dropdown.Trigger
        class={cn(props.triggerClass)}
        size="icon-sm"
        variant="ghost"
      >
        <DotsThree />
      </Dropdown.Trigger>
      <Dropdown.Content class="w-64 shadow-menu">
        <For each={sections()}>
          {(section) => (
            <Dropdown.Group>
              <For each={section.actions}>{item}</For>
            </Dropdown.Group>
          )}
        </For>
      </Dropdown.Content>
    </Dropdown>
  );
}

function MobileRender(
  props: SplitFileMenuRenderProps & { views?: SplitFileMenuViews }
) {
  const [expandedSubmenu, setExpandedSubmenu] =
    createSignal<SplitFileMenuAction>();
  const sections = () => getSplitFileMenuActionSections(props.groups);

  const item = (action: SplitFileMenuAction, nested = false) => {
    const children = () => action.children?.filter(Boolean) ?? [];
    const expanded = () => expandedSubmenu() === action;

    return (
      <Show
        when={children().length > 0}
        fallback={
          <button
            type="button"
            class={cn(
              'w-full bg-surface flex items-center gap-3 py-3 text-sm hover:bg-hover hover-transition-bg text-left not-last:mb-px text-ink',
              nested ? 'pl-9 pr-4' : 'px-4'
            )}
            onClick={(e) => {
              action.action?.(e);
              props.onOpenChange(false);
            }}
          >
            <SplitMenuItemContent {...action} showHotkey={false} />
          </button>
        }
      >
        <div class="w-full bg-surface">
          <button
            type="button"
            class={cn(
              'w-full flex items-center gap-3 py-3 text-sm hover:bg-hover hover-transition-bg text-left text-ink',
              nested ? 'pl-9 pr-4' : 'px-4'
            )}
            onClick={() => {
              setExpandedSubmenu(expanded() ? undefined : action);
            }}
          >
            <SplitMenuItemContent {...action} showHotkey={false} />
            <Dynamic
              component={expanded() ? CaretDown : CaretRight}
              class="size-3.5 shrink-0"
            />
          </button>
          <Show when={expanded()}>
            <div class="border-t border-edge-muted/60">
              <For each={children()}>{(child) => item(child, true)}</For>
            </div>
          </Show>
        </div>
      </Show>
    );
  };

  return (
    <MobileDrawer
      side="bottom"
      open={props.open}
      onOpenChange={props.onOpenChange}
      preventScroll={false}
      preventScrollbarShift={false}
    >
      <MobileDrawer.Portal>
        <MobileDrawer.Overlay class="fixed inset-0 z-modal-overlay bg-modal-overlay pattern-diagonal-4 pattern-edge-muted" />
        <MobileDrawer.Content aria-label="File actions">
          <MobileDrawer.Handle />
          <MobileDrawer.ScrollBody>
            <Show when={props.views}>
              {(views) => (
                <>
                  <MobileDrawer.Label id="split-file-menu-views-label">
                    {views().title}
                  </MobileDrawer.Label>
                  <MobileDrawer.Section
                    role="radiogroup"
                    aria-labelledby="split-file-menu-views-label"
                    class="flex flex-col shrink-0 mb-3"
                  >
                    <For each={views().options}>
                      {(option) => (
                        <button
                          type="button"
                          role="radio"
                          aria-checked={views().value === option.value}
                          class="w-full bg-surface flex items-center gap-3 py-3 px-4 text-sm hover:bg-hover hover-transition-bg text-left not-last:mb-px text-ink"
                          onClick={() => {
                            views().onSelect(option.value);
                            props.onOpenChange(false);
                          }}
                        >
                          <SplitMenuItemContent
                            icon={option.icon}
                            label={option.label}
                            showHotkey={false}
                          />
                          <Show when={views().value === option.value}>
                            <Check class="size-3.5 text-accent shrink-0" />
                          </Show>
                        </button>
                      )}
                    </For>
                  </MobileDrawer.Section>
                  {/* With a views group leading the drawer, title the action
                      sections to set the two apart. */}
                  <Show when={sections().length > 0}>
                    <MobileDrawer.Label>Actions</MobileDrawer.Label>
                  </Show>
                </>
              )}
            </Show>
            <For each={sections()}>
              {(section, index) => (
                <>
                  <Show when={index() > 0}>
                    <div class="mt-3" />
                  </Show>
                  <MobileDrawer.Section class="flex flex-col shrink-0">
                    <For each={section.actions}>{(action) => item(action)}</For>
                  </MobileDrawer.Section>
                </>
              )}
            </For>
          </MobileDrawer.ScrollBody>
        </MobileDrawer.Content>
      </MobileDrawer.Portal>
    </MobileDrawer>
  );
}

export function SplitFileMenu(props: {
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
   * can build one that generic chrome can't reconstruct from id/name/blockName
   * alone (e.g. calls need their channelId).
   */
  entity?: EntityData;
  buttonClass?: string;
}) {
  const ctx = useContext(SplitPanelContext);
  if (!ctx)
    throw new Error('<SplitFileMenu> must be used in <SplitPanelContext>');

  const isOwner = useIsDocumentOwner();
  const blockName = useBlockName();
  const aliasedBlockName = useBlockAliasedName();
  const itemType = blockNameToItemType(blockName);
  if (!itemType) throw new Error(`Using bad item type for block: ${blockName}`);

  const [open, setOpen] = createSignal(false);
  const itemOperations = useItemOperations();
  const quickAccess = useQuickAccess();
  const favoriteAction = makeFavoriteAction();
  const userId = useUserId();
  const notificationSource = useGlobalNotificationSource();
  const muteAction = makeMuteAction({
    notificationSource: () => notificationSource,
  });
  const markDone = makeMarkDoneAction({
    userId: () => userId(),
    notificationSource: () => notificationSource,
  });
  // Same follow-up as the block's command menu and every soup list: the
  // reminder brings the entity back, so it is marked done now. No soup list is
  // behind this menu, so nothing advances.
  const createReminderAction = makeCreateReminderAction({
    onCreated: markReminderTargetDone(markDone),
  });
  const addTagAction = makeAddTagAction();
  const copyLinkAction = makeCopyLinkAction();
  const copyEntityIdAction = makeCopyEntityIdAction();

  // Blocks outside BLOCKS_WITH_ENTITY_HOTKEYS never register these
  // shortcuts, so badging them there would advertise dead shortcuts.
  const blockHotkeyToken = (token: HotkeyToken): HotkeyToken | undefined =>
    BLOCKS_WITH_ENTITY_HOTKEYS.has(blockName) ? token : undefined;

  const { replaceOrInsertSplit } = useSplitLayout();

  // The entity this menu operates on: the block's own entity when supplied,
  // else the quick-access cache (richer data, covers channels/calls), else
  // built from the block's id/name/blockName like the rename/move ops do.
  const menuEntity = createMemo<EntityData | undefined>(() => {
    if (props.entity) return props.entity;
    const item = quickAccess.getById(props.id);
    if (item?.kind === 'entity') return item.data;
    return buildEntityData({
      id: props.id,
      name: props.name,
      blockName: aliasedBlockName,
    });
  });

  const favoriteOp = (): SplitFileMenuAction | undefined => {
    const entity = menuEntity();
    if (!entity || !favoriteAction.canExecute(entity)) return undefined;
    return {
      label: favoriteAction.isFavorited(entity) ? 'Unfavorite' : 'Favorite',
      icon: Star,
      action: () => {
        void favoriteAction.execute([entity]);
      },
      hotkeyToken: blockHotkeyToken(TOKENS.entity.action.favorite),
      group: 'macro' as const,
    };
  };

  const muteOp = (): SplitFileMenuAction | undefined => {
    const entity = menuEntity();
    if (!entity || !muteAction.canExecute(entity)) return undefined;
    const muted = muteAction.isMuted(entity);
    return {
      label: muted ? 'Unmute notifications' : 'Mute notifications',
      icon: muted ? BellSimple : BellSlash,
      action: () => {
        void muteAction.execute([entity]);
      },
      hotkeyToken: blockHotkeyToken(TOKENS.entity.action.mute),
      group: 'macro' as const,
    };
  };

  // Read reactively as well as through the action's imperative gate: `ops` below
  // is a memo, so without a reactive dependency the item would stay missing for
  // the life of this menu if PostHog answered after it was first computed. The
  // other reminder surfaces re-evaluate per interaction and don't need this.
  const remindersFlag = useFeatureFlag(enableReminders);

  // Injected here rather than per-block so every block rendering this menu gets
  // it, the way Favorite does. Entity types the reminders API cannot mint an
  // access receipt for (channel messages/threads) return undefined and are
  // filtered out.
  const reminderOp = (): SplitFileMenuAction | undefined => {
    if (!remindersFlag().enabled) return undefined;
    const entity = menuEntity();
    if (!entity || !createReminderAction.canExecute(entity)) return undefined;
    return {
      label: 'Remind me',
      icon: BellSimple,
      action: () => {
        setOpen(false);
        createReminderAction.execute([entity]);
      },
      hotkeyToken: blockHotkeyToken(TOKENS.entity.action.createReminder),
      group: 'macro' as const,
    };
  };

  // Only offered when the block's entity type can be tagged.
  const addTagOp = (): SplitFileMenuAction | undefined => {
    const entity = menuEntity();
    if (!entity || !addTagAction.canExecute(entity)) return undefined;
    return {
      label: 'Add tag',
      icon: Tag,
      action: () => {
        setOpen(false);
        addTagAction.execute([entity]);
      },
      hotkeyToken: blockHotkeyToken(TOKENS.entity.action.tags),
      group: 'macro' as const,
    };
  };

  const copyLinkOp = (): SplitFileMenuAction | undefined => {
    const entity = menuEntity();
    // Some entities have no shareable link (a reminder resolves to no block, so
    // its URL is dead); skip the item rather than copy one that won't open.
    if (entity && !copyLinkAction.canExecute(entity)) return undefined;
    // Foreign PRs link out via their entity URL (GitHub); the block-derived
    // fallback would mint an internal /pr URL that doesn't resolve, so omit
    // the item when the entity is unavailable.
    if (!entity && blockName === 'pr') return undefined;
    return {
      label: 'Copy Link',
      icon: Link,
      action: () => {
        if (entity) {
          void copyLinkAction.execute([entity]);
        } else {
          void copyLinkAction.executeByBlock(props.id, aliasedBlockName);
        }
      },
      hotkeyToken: blockHotkeyToken(TOKENS.entity.action.copyLink),
      group: 'sharing' as const,
    };
  };

  const copyEntityIdOp = (): SplitFileMenuAction => ({
    label: 'Copy ID',
    icon: Copy,
    action: () => {
      void copyEntityIdAction.executeById(props.id);
    },
    hotkeyToken: blockHotkeyToken(TOKENS.entity.action.copyEntityId),
    group: 'sharing' as const,
  });

  createEffect(() => {
    const openMenu = () => setOpen(true);
    ctx.setTitleFileMenuTrigger(() => openMenu);
    onCleanup(() => ctx.setTitleFileMenuTrigger(undefined));
  });

  const ops = createMemo<SplitFileMenuAction[]>(() => {
    const mapped = props.ops
      .map((op) => {
        if (isDefaultFileOperation(op)) {
          switch (op.op) {
            case 'delete':
              if (!isOwner()) return null;
              return {
                label: 'Delete',
                action: () => {
                  const entity = buildEntityData({
                    id: props.id,
                    name: props.name,
                    blockName: aliasedBlockName,
                  });
                  if (!entity) return;
                  setOpen(false);
                  openBulkEditModal({
                    view: 'delete',
                    entities: [entity],
                    onFinish: () => {
                      toast.success('Deleted');
                      returnSplitToRecentListView(ctx.handle);
                    },
                    onError: () => toast.failure('Failed to delete'),
                  });
                },
                icon: Trash,
                group: 'delete' as const,
              };

            case 'rename':
              if (!isOwner()) return null;
              return {
                label: 'Rename',
                action: () => {
                  const entity = buildEntityData({
                    id: props.id,
                    name: props.name,
                    blockName: aliasedBlockName,
                  });
                  if (!entity) return;
                  setOpen(false);
                  openBulkEditModal({
                    view: 'rename',
                    entities: [entity],
                    onFinish: () => toast.success('Renamed'),
                    onError: () => toast.failure('Failed to rename'),
                  });
                },
                icon: Rename,
                hotkeyToken: blockHotkeyToken(TOKENS.entity.action.rename),
                group: 'file' as const,
              };

            case 'copy':
              return {
                label: 'Duplicate',
                action: async () => {
                  if (props.itemType === 'project') {
                    console.warn(
                      'Attempting to copy project!. This should not happen'
                    );
                    return;
                  }
                  const res = await itemOperations.copyItem({
                    itemType: props.itemType,
                    id: props.id,
                    name: props.name,
                  });
                  if (res) {
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
                group: 'file' as const,
              };

            case 'moveToProject':
              if (!isOwner()) return null;
              return {
                label: 'Move to Folder',
                action: () => {
                  const entity = buildEntityData({
                    id: props.id,
                    name: props.name,
                    blockName: aliasedBlockName,
                  });
                  if (!entity) return;
                  setOpen(false);
                  openBulkEditModal({
                    view: 'moveToProject',
                    entities: [entity],
                    onFinish: () => toast.success('Moved to folder'),
                    onError: () => toast.failure('Failed to move to folder'),
                  });
                },
                icon: ArrowRight,
                hotkeyToken: blockHotkeyToken(
                  TOKENS.entity.action.moveToFolder
                ),
                group: 'file' as const,
              };
          }
        } else {
          return op;
        }
      })
      .filter((op) => !!op);
    return [
      favoriteOp(),
      muteOp(),
      reminderOp(),
      addTagOp(),
      copyLinkOp(),
      copyEntityIdOp(),
      ...mapped,
    ].filter((op) => !!op);
  });

  const filteredTools = createMemo(() =>
    (props.tools ?? []).filter((t) => !t.condition || t.condition())
  );

  const tools = createMemo<SplitFileMenuAction[]>(() =>
    filteredTools().map((tool) => ({
      label: typeof tool.label === 'function' ? tool.label() : tool.label,
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

  const actionGroups = createMemo<SplitFileMenuActionGroups>(() => {
    const groups: SplitFileMenuActionGroups = {
      entity: [],
      sender: [],
      sharing: [],
      macro: [],
      file: [],
      delete: [],
    };
    for (const tool of tools()) {
      groups[tool.group ?? 'entity'].push(tool);
    }
    for (const op of ops()) {
      groups[op.group ?? 'entity'].push(op);
    }
    return groups;
  });

  createEffect(() => {
    ctx.setTitleFileMenuActions(actionGroups());
  });

  onCleanup(() => ctx.setTitleFileMenuActions(undefined));

  return (
    <Show
      when={isTouchDevice()}
      fallback={
        <DesktopRender
          open={open()}
          onOpenChange={setOpen}
          triggerClass={props.buttonClass}
          groups={actionGroups()}
        />
      }
    >
      <MobileRender
        open={open()}
        onOpenChange={setOpen}
        triggerClass={props.buttonClass}
        groups={actionGroups()}
        views={props.mobileViews}
      />
    </Show>
  );
}
