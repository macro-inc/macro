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
  notificationSettingsMenuFor,
} from '@app/features/next-soup/actions';
import { ProjectAssignmentDialog } from '@app/features/projects/projects';
import { EntityTagSubmenu } from '@app/features/property/tags/EntityTagSubmenu';
import { useFeatureFlag } from '@app/lib/analytics/posthog';
import { t } from '@app/lib/i18n';
import type { BlockTool } from '@components/app/block-tool';
import { useGlobalNotificationSource } from '@components/app/GlobalAppState';
import { MobileDrawer } from '@components/app/mobile/MobileDrawer';
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
import CaretDown from '@icon/system/regular/caret-down.svg';
import CaretRight from '@icon/system/regular/caret-right.svg';
import Check from '@icon/system/regular/check.svg';
import Copy from '@icon/system/regular/copy.svg';
import ProjectIcon from '@icon/system/regular/cube.svg';
import DotsThree from '@icon/system/regular/dots-three.svg';
import FolderIcon from '@icon/system/regular/folder.svg';
import Link from '@icon/system/regular/link.svg';
import PaintBrush from '@icon/system/regular/paint-brush.svg';
import Rename from '@icon/system/regular/pencil-line.svg';
import Star from '@icon/system/regular/star.svg';
import Tag from '@icon/system/regular/tag.svg';
import Trash from '@icon/system/regular/trash-simple.svg';
import {
  NotificationMuteMenu,
  NotificationMutePage,
} from '@notifications/components/NotificationMuteMenu';
import {
  NotificationSettingsMenu,
  NotificationSettingsPage,
  NotificationSettingsSummary,
} from '@notifications/components/NotificationSettingsMenu';
import { useChannelNotificationSettings } from '@notifications/primitives/create-channel-notification-settings';

import type { ItemType } from '@service-storage/itemType';
import { Key } from '@solid-primitives/keyed';
import { CopyButton, cn, Dropdown, Hotkey } from '@ui';
import {
  type Component,
  createEffect,
  createMemo,
  createSignal,
  For,
  type JSX,
  Match,
  onCleanup,
  Show,
  Switch,
  useContext,
} from 'solid-js';
import { Dynamic } from 'solid-js/web';
import { match } from 'ts-pattern';
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
  id?: string;
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

function SplitMenuItemContent(
  props: Pick<
    SplitFileMenuAction,
    'hotkeyToken' | 'icon' | 'label' | 'disabledReason'
  > & {
    showHotkey?: boolean;
  }
) {
  return (
    <>
      <Show when={props.icon}>
        {(icon) => (
          <Dynamic
            component={icon() as Component<JSX.SvgSVGAttributes<SVGSVGElement>>}
            class="size-4 shrink-0"
          />
        )}
      </Show>
      <div class="min-w-0 flex-1">
        <div class="truncate">{props.label}</div>
        <Show when={props.disabledReason}>
          <div class="text-xs text-ink-muted">{props.disabledReason}</div>
        </Show>
      </div>
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
  triggerLabel?: string;
  groups: SplitFileMenuActionGroups;
};

function DesktopRender(props: SplitFileMenuRenderProps) {
  const sections = () => getSplitFileMenuActionSections(props.groups);

  const item = (action: () => SplitFileMenuAction) => {
    const children = () => action().children?.filter(Boolean) ?? [];
    const content = () => (
      <SplitMenuItemContent
        label={action().label}
        icon={action().icon}
        hotkeyToken={action().hotkeyToken}
      />
    );
    return (
      <Switch>
        <Match when={action().menuItem}>
          {(component) => (
            <Dynamic
              component={component()}
              onActionComplete={() => props.onOpenChange(false)}
            />
          )}
        </Match>
        <Match when={action().muteMenu}>
          {(menu) => (
            <NotificationMuteMenu
              {...menu()}
              onActionComplete={() => props.onOpenChange(false)}
            />
          )}
        </Match>
        <Match when={action().notificationSettingsMenu}>
          {(menu) => (
            <NotificationSettingsMenu
              {...menu()}
              onActionComplete={() => props.onOpenChange(false)}
            />
          )}
        </Match>
        <Match when={action().copy}>
          <Dropdown.CopyItem
            icon={<Dynamic component={action().icon ?? Copy} class="size-4" />}
            onCopy={async () => (await action().action?.()) !== false}
          >
            <SplitMenuItemContent
              label={action().label}
              hotkeyToken={action().hotkeyToken}
            />
          </Dropdown.CopyItem>
        </Match>
        <Match when={children().length > 0}>
          <Dropdown.Sub>
            <Dropdown.SubTrigger>
              {content()}
              <CaretRight class="size-3.5 shrink-0" />
            </Dropdown.SubTrigger>
            <Dropdown.SubContent>
              <Dropdown.Group>
                <Key each={children()} by={(child) => child.id ?? child.label}>
                  {item}
                </Key>
              </Dropdown.Group>
            </Dropdown.SubContent>
          </Dropdown.Sub>
        </Match>
        <Match when={true}>
          <Dropdown.Item
            disabledReason={action().disabledReason}
            onSelect={() => {
              fireAndForget(action().action?.(), 'split-file-menu');
              props.onOpenChange(false);
            }}
          >
            {content()}
          </Dropdown.Item>
        </Match>
      </Switch>
    );
  };

  return (
    <Dropdown open={props.open} onOpenChange={props.onOpenChange}>
      <Dropdown.Trigger
        class={cn(props.triggerClass)}
        aria-label={props.triggerLabel ?? t('splitMenu.fileActions')}
        size="icon-sm"
        variant="ghost"
      >
        <DotsThree class="size-3.5 touch:size-6 shrink-0 pointer-events-none" />
      </Dropdown.Trigger>
      <Dropdown.Content class="min-w-64 max-w-[min(22rem,calc(100vw-1rem))]">
        <Key each={sections()} by="key">
          {(section) => (
            <Dropdown.Group>
              <Key
                each={section().actions}
                by={(action) => action.id ?? action.label}
              >
                {item}
              </Key>
            </Dropdown.Group>
          )}
        </Key>
      </Dropdown.Content>
    </Dropdown>
  );
}

function MobileRender(
  props: SplitFileMenuRenderProps & { views?: SplitFileMenuViews }
) {
  const [expandedSubmenu, setExpandedSubmenu] = createSignal<string | number>();
  const sections = () => getSplitFileMenuActionSections(props.groups);
  // A drill-in page that replaces the actions: mute choices or settings.
  const [page, setPage] = createSignal<'mute' | 'settings'>();
  const actions = () => sections().flatMap((section) => section.actions);
  const muteMenu = () =>
    page() === 'mute'
      ? actions().find((action) => action.muteMenu)?.muteMenu
      : undefined;
  const settingsMenu = () =>
    page() === 'settings'
      ? actions().find((action) => action.notificationSettingsMenu)
          ?.notificationSettingsMenu
      : undefined;
  const close = () => {
    setPage(undefined);
    props.onOpenChange(false);
  };

  const item = (
    action: () => SplitFileMenuAction,
    nested = false,
    key: string | number = action().id ?? 0
  ) => {
    if (action().muteMenu) {
      return (
        <MobileDrawer.Item
          disabled={action().muteMenu?.disabled}
          onClick={() => {
            if (action().muteMenu?.muted) {
              action().muteMenu?.onMute(false);
              close();
            } else setPage('mute');
          }}
        >
          <Dynamic
            component={action().muteMenu?.muted ? BellSimple : BellSlash}
            class="size-4 shrink-0"
          />
          {action().muteMenu?.muted
            ? action().muteMenu?.unmuteLabel
            : action().muteMenu?.label}
          <Show when={!action().muteMenu?.muted}>
            <CaretRight class="size-3.5" />
          </Show>
        </MobileDrawer.Item>
      );
    }
    if (action().notificationSettingsMenu) {
      return (
        <MobileDrawer.Item
          disabled={action().notificationSettingsMenu?.disabled}
          onClick={() => setPage('settings')}
        >
          <BellSimple class="size-4 shrink-0" />
          {action().label}
          <Show when={action().notificationSettingsMenu}>
            {(menu) => <NotificationSettingsSummary preset={menu().preset} />}
          </Show>
          <CaretRight class="size-3.5 shrink-0" />
        </MobileDrawer.Item>
      );
    }
    const children = () => action().children?.filter(Boolean) ?? [];
    const expanded = () => expandedSubmenu() === key;

    if (action().copy)
      return (
        <CopyButton
          as={MobileDrawer.Item}
          class={cn(nested ? 'pl-9 pr-4' : 'px-4')}
          onClick={() => action().action?.()}
          icon={<Dynamic component={action().icon ?? Copy} class="size-4" />}
        >
          <SplitMenuItemContent label={action().label} showHotkey={false} />
        </CopyButton>
      );

    return (
      <Show
        when={children().length > 0}
        fallback={
          <MobileDrawer.Item
            type="button"
            disabled={!!action().disabledReason}
            class={cn(
              nested ? 'pl-9 pr-4' : 'px-4',
              action().danger && 'text-failure'
            )}
            onClick={(e) => {
              fireAndForget(action().action?.(e), 'split-file-menu');
              props.onOpenChange(false);
            }}
          >
            <SplitMenuItemContent
              label={action().label}
              icon={action().icon}
              hotkeyToken={action().hotkeyToken}
              showHotkey={false}
              disabledReason={action().disabledReason}
            />
          </MobileDrawer.Item>
        }
      >
        <div class="w-full">
          <MobileDrawer.Item
            type="button"
            class={cn(nested ? 'pl-9 pr-4' : 'px-4')}
            onClick={() => {
              setExpandedSubmenu(expanded() ? undefined : key);
            }}
          >
            <SplitMenuItemContent
              label={action().label}
              icon={action().icon}
              hotkeyToken={action().hotkeyToken}
              showHotkey={false}
            />
            <Dynamic
              component={expanded() ? CaretDown : CaretRight}
              class="size-3.5 shrink-0"
            />
          </MobileDrawer.Item>
          <Show when={expanded()}>
            <div class="pt-1">
              <For each={children().map((child, index) => child.id ?? index)}>
                {(childKey) =>
                  item(
                    () =>
                      children().find(
                        (child, index) => (child.id ?? index) === childKey
                      )!,
                    true,
                    childKey
                  )
                }
              </For>
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
      onOpenChange={(open) => {
        if (!open) setPage(undefined);
        props.onOpenChange(open);
      }}
      preventScroll={false}
      preventScrollbarShift={false}
    >
      <MobileDrawer.Portal>
        <MobileDrawer.Overlay />
        <MobileDrawer.Content aria-label={t('splitMenu.fileActions')}>
          <MobileDrawer.Handle />
          <MobileDrawer.ScrollBody>
            <Show
              when={page()}
              fallback={
                <>
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
                              <MobileDrawer.Item
                                type="button"
                                role="radio"
                                aria-checked={views().value === option.value}
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
                              </MobileDrawer.Item>
                            )}
                          </For>
                        </MobileDrawer.Section>
                        {/* With a views group leading the drawer, title the action
                      sections to set the two apart. */}
                        <Show when={sections().length > 0}>
                          <MobileDrawer.Label>
                            {t('entityActions.actions')}
                          </MobileDrawer.Label>
                        </Show>
                      </>
                    )}
                  </Show>
                  <For each={sections().map((section) => section.key)}>
                    {(key, index) => {
                      const actions = () =>
                        sections().find((section) => section.key === key)!
                          .actions;
                      return (
                        <>
                          <Show when={index() > 0}>
                            <div class="mt-3" />
                          </Show>
                          <MobileDrawer.Section class="flex flex-col shrink-0">
                            <For
                              each={actions().map(
                                (action, index) => action.id ?? index
                              )}
                            >
                              {(id) =>
                                item(
                                  () =>
                                    actions().find(
                                      (action, index) =>
                                        (action.id ?? index) === id
                                    )!,
                                  false,
                                  id
                                )
                              }
                            </For>
                          </MobileDrawer.Section>
                        </>
                      );
                    }}
                  </For>
                </>
              }
            >
              <Show
                when={settingsMenu()}
                fallback={
                  <Show when={muteMenu()}>
                    {(menu) => (
                      <NotificationMutePage
                        {...menu()}
                        onBack={() => setPage(undefined)}
                        onActionComplete={close}
                      />
                    )}
                  </Show>
                }
              >
                {(menu) => (
                  <NotificationSettingsPage
                    {...menu()}
                    onBack={() => setPage(undefined)}
                    onActionComplete={close}
                  />
                )}
              </Show>
            </Show>
          </MobileDrawer.ScrollBody>
        </MobileDrawer.Content>
      </MobileDrawer.Portal>
    </MobileDrawer>
  );
}

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
  /** Presentation-only grouping for a host's phone action sheet. */
  mobileActionGroups?: (
    groups: SplitFileMenuActionGroups
  ) => SplitFileMenuActionGroups;
  /**
   * Full entity for the menu's entity-gated items. Supply it when the block
   * can build one that generic chrome can't reconstruct from id/name/entityKind
   * alone (e.g. calls need their channelId).
   */
  entity?: EntityData;
  buttonClass?: string;
  triggerLabel?: string;
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
  const channelSettings = useChannelNotificationSettings();
  const muteAction = makeMuteAction({
    notificationSource: () => notificationSource,
    channelSettings,
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
  const tagMenuItem = (menu: { onActionComplete?: () => void }) => (
    <Show when={menuEntity()}>
      {(entity) => (
        <EntityTagSubmenu
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
      group: 'file',
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
      group: 'macro' as const,
    };
  };

  const notificationSettingsOp = (): SplitFileMenuAction | undefined => {
    const entity = menuEntity();
    const menu =
      entity && notificationSettingsMenuFor(channelSettings, [entity]);
    if (!menu) return undefined;
    return {
      id: 'notification-settings',
      label: t('channelSections.notificationSettings'),
      icon: BellSimple,
      notificationSettingsMenu: menu,
      group: 'notifications' as const,
    };
  };

  const muteOp = (): SplitFileMenuAction | undefined => {
    const entity = menuEntity();
    if (!entity || !muteAction.canExecute(entity)) return undefined;
    // With Notification Settings, Mute joins it in a section of its own.
    const hasSettings = notificationSettingsMenuFor(channelSettings, [entity]);
    const muted = muteAction.isMuted(entity);
    const muteMenu = muteAction.menu([entity]);
    return {
      id: 'mute',
      label: muted ? muteMenu.unmuteLabel : muteMenu.label,
      icon: muted ? BellSimple : BellSlash,
      muteMenu,
      action: () => {
        fireAndForget(muteAction.execute([entity]), 'entity-actions');
      },
      get hotkeyToken() {
        return activeHotkeyToken(TOKENS.entity.action.mute);
      },
      group: hasSettings ? ('notifications' as const) : ('macro' as const),
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
      group: 'macro' as const,
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
      group: 'macro' as const,
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
      group: 'sharing' as const,
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
    group: 'sharing' as const,
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
                group: 'file' as const,
              };
            })
            .with('copy', () => {
              if (!canDuplicateItemType(props.itemType)) return null;
              return {
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
                group: 'file' as const,
              };
            })
            .with('moveToProject', () => {
              if (!ownsMenuEntity()) return null;
              return {
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
                group: 'file' as const,
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
        action.id = op.id ?? `operation-${index}`;
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
      notificationSettingsOp(),
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
              group: 'file' as const,
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

  const actionGroups = createMemo<SplitFileMenuActionGroups>(() => {
    const groups: SplitFileMenuActionGroups = {
      entity: [],
      sender: [],
      sharing: [],
      macro: [],
      notifications: [],
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
    <>
      <Show
        when={isTouchDevice()}
        fallback={
          <DesktopRender
            open={open()}
            onOpenChange={setOpen}
            triggerClass={props.buttonClass}
            triggerLabel={props.triggerLabel}
            groups={actionGroups()}
          />
        }
      >
        <MobileRender
          open={open()}
          onOpenChange={setOpen}
          triggerClass={props.buttonClass}
          groups={props.mobileActionGroups?.(actionGroups()) ?? actionGroups()}
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
