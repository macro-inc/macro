import { DocumentTitleHoverCard } from '@app/components/entity-detail/DocumentTitleHoverCard';
import type { EntityAppearance } from '@app/features/entity-appearance/core/appearance';
import { t } from '@app/lib/i18n';
import { isInBlock, useBlockAliasedName } from '@core/block';
import {
  ContextMenuContent,
  CopyMenuItem,
  dismissContextMenu,
  MenuItem,
  MenuSeparator,
  SubTrigger,
} from '@core/component/ContextMenu';
import {
  EntityIcon,
  type EntityIconSelector,
} from '@core/component/EntityIcon';
import { InlineTitleEditor } from '@core/component/InlineTitleEditor';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import { blockMetadataSignal } from '@core/signal/load';
import {
  useCanComment,
  useCanEdit,
  useCanView,
  useIsDocumentOwner,
} from '@core/signal/permissions';
import { useBlockDocumentName } from '@core/util/currentBlockDocumentName';
import type { DateValue } from '@core/util/date';
import type { BuildEntityDataArgs } from '@entity';
import CaretDownIcon from '@icon/system/regular/caret-down.svg';
import { ContextMenu } from '@kobalte/core/context-menu';
import { NotificationMuteMenu } from '@notifications/components/NotificationMuteMenu';
import { NotificationSettingsMenu } from '@notifications/components/NotificationSettingsMenu';
import { Key } from '@solid-primitives/keyed';
import { cn, Tooltip } from '@ui';
import {
  type Accessor,
  type Component,
  children,
  createMemo,
  createSignal,
  type JSX,
  Match,
  onCleanup,
  type ParentProps,
  Show,
  Switch,
} from 'solid-js';
import { Dynamic, Portal } from 'solid-js/web';
import {
  getSplitFileMenuActionSections,
  type SplitFileMenuAction,
  type SplitPanelContextType,
} from '../context';
import { useSplitDisplayName, useSplitPanelOrThrow } from '../layoutUtils';
import { HeaderIsland } from './HeaderIsland';

export function StaticSplitLabel(props: {
  label: string;
  iconType?: EntityIconSelector;
  icon?: JSX.Element;
  badges?: JSX.Element;
  class?: string;
  weight?: 'normal' | 'semibold';
  colorIcon?: boolean;
  /** Enables double-click renaming while retaining the split title/menu
   * chrome. */
  onRename?: (name: string) => void;
  renameAriaLabel?: string;
}) {
  const panel = useSplitPanelOrThrow();
  const [renaming, setRenaming] = createSignal(false);
  useSplitDisplayName(() => props.label);
  const startRename = (event: MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    setRenaming(true);
  };
  const openTitleFileMenu = (e: MouseEvent) => {
    if (!isTouchDevice()) return;
    const trigger = panel.titleFileMenuTrigger();
    if (!trigger) return;
    e.preventDefault();
    e.stopPropagation();
    trigger();
  };
  return (
    <SplitLabelContextMenu>
      <HeaderIsland class="shrink" onClick={openTitleFileMenu}>
        <div
          class={cn(
            'z-split-header-content relative flex items-center gap-1.5 max-w-full h-full shrink',
            props.class
          )}
        >
          <Show when={props.iconType}>
            <EntityIcon
              class="shrink-0"
              targetType={props.iconType}
              size="xs"
              theme={props.colorIcon ? undefined : 'monochrome'}
            />
          </Show>
          <Show when={props.icon}>
            <div class="flex shrink-0 items-center justify-center">
              {props.icon}
            </div>
          </Show>
          <Show when={props.badges}>{props.badges}</Show>
          <span class="inline-flex min-w-0 items-center gap-1">
            <Show
              when={props.onRename}
              fallback={
                <span
                  class={cn(
                    'inline-block truncate text-sm',
                    props.weight === 'normal' ? 'font-normal' : 'font-semibold'
                  )}
                >
                  {props.label}
                </span>
              }
            >
              {(onRename) => (
                <Show
                  when={renaming()}
                  fallback={
                    <span
                      class={cn(
                        'inline-block truncate text-sm',
                        props.weight === 'normal'
                          ? 'font-normal'
                          : 'font-semibold'
                      )}
                      onDblClick={startRename}
                      onClick={(event) => {
                        if (isTouchDevice()) startRename(event);
                      }}
                    >
                      {props.label}
                    </span>
                  }
                >
                  <span
                    onClick={(event) => event.stopPropagation()}
                    onDblClick={(event) => event.stopPropagation()}
                  >
                    <InlineTitleEditor
                      value={props.label}
                      placeholder={t('splitMenu.untitled')}
                      ariaLabel={
                        props.renameAriaLabel ?? t('entityActions.rename')
                      }
                      onRename={onRename()}
                      class="text-sm"
                      autofocus
                      onExit={() => setRenaming(false)}
                    />
                  </span>
                </Show>
              )}
            </Show>
            <Show when={panel.titleFileMenuTrigger()}>
              <CaretDownIcon class="hidden size-3.5 shrink-0 text-ink-muted touch:block" />
            </Show>
          </span>
          <div
            class="shrink-0 flex items-center h-full"
            ref={titleFileMenuMount(panel)}
          />
        </div>
      </HeaderIsland>
    </SplitLabelContextMenu>
  );
}

export function SplitLabel(props: {
  label: string;
  lockRename?: boolean;
  /** Per-variant fields the block context can't supply (e.g. `channelType`
   * for a channel rename). Merged into the args passed to `buildEntityData`. */
  renameOverrides?: Partial<BuildEntityDataArgs>;
  maxDisplayLength?: number;
}) {
  const panel = useSplitPanelOrThrow();

  useSplitDisplayName(() => props.label);

  const truncatedLabel = () => {
    if (!props.maxDisplayLength) return props.label;
    if (props.label.length <= props.maxDisplayLength) return props.label;
    return props.label.slice(0, props.maxDisplayLength - 3) + '...';
  };

  const openTitleFileMenu = (e: MouseEvent) => {
    if (!isTouchDevice()) return;
    const trigger = panel.titleFileMenuTrigger();
    if (!trigger) return;
    e.preventDefault();
    e.stopPropagation();
    trigger();
  };

  return (
    <span class="flex min-w-0 items-center gap-1" onClick={openTitleFileMenu}>
      <span class="inline-block truncate text-sm font-semibold">
        {truncatedLabel()}
      </span>
      <Show when={panel.titleFileMenuTrigger()}>
        <CaretDownIcon class="hidden size-4 shrink-0 text-ink-muted touch:block" />
      </Show>
    </span>
  );
}

export function SplitHeaderBadge(props: { text: string; tooltip?: string }) {
  return (
    <span class="py-0.5 px-2 rounded-none text-xxs text-ink-muted">
      <Tooltip label={props.tooltip ?? ''} as="span">
        <span class="font-mono uppercase">{props.text}</span>
      </Tooltip>
    </span>
  );
}

/** Access the viewer lacks to edit, shown beside a document's title. */
export function AccessBadge(props: {
  canEdit: boolean;
  canComment: boolean;
  canView: boolean;
}) {
  const tooltip = () => {
    if (!props.canView) return t('splitMenu.noAccess');
    if (props.canComment) return t('splitMenu.commentOnly');
    return t('splitMenu.viewOnly');
  };

  const text = () => {
    if (!props.canView) return t('splitMenu.badgeNoAccess');
    if (props.canComment) return t('splitMenu.badgeCommentOnly');
    return t('splitMenu.badgeViewer');
  };

  return (
    <Show when={!props.canEdit}>
      <SplitHeaderBadge text={text()} tooltip={tooltip()} />
    </Show>
  );
}

/** Reads access from the enclosing legacy Block. */
export function SplitPermissionsBadge() {
  const canEdit = useCanEdit();
  const canComment = useCanComment();
  const canView = useCanView();
  return (
    <AccessBadge
      canEdit={canEdit()}
      canComment={canComment()}
      canView={canView()}
    />
  );
}

/** What a document title's hover card shows. */
export type SplitLabelDocument = {
  documentId: string;
  ownerId?: string;
  createdAt?: DateValue | null;
  updatedAt?: DateValue | null;
};

/**
 * A split's title island: icon, name, and the title file menu. On touch the
 * island opens that menu. Block-free; {@link BlockItemSplitLabel} adapts it.
 */
export function EntitySplitLabel(props: {
  targetType: EntityIconSelector;
  /** The entity's own icon and color, when it has chosen one. */
  appearance?: EntityAppearance | null;
  name: string;
  document?: SplitLabelDocument;
  icon?: JSX.Element;
  lockRename?: boolean;
  badges?: JSX.Element;
  /** Rendered after the file name. */
  trailingBadges?: JSX.Element;
  /** Replaces the static name, e.g. with an inline title editor. */
  title?: JSX.Element;
}) {
  const panel = useSplitPanelOrThrow();
  const suppliedIcon = children(() => props.icon);
  useSplitDisplayName(() => props.name);

  const openTitleFileMenu = (e: MouseEvent) => {
    if (!isTouchDevice()) return;
    const trigger = panel.titleFileMenuTrigger();
    if (!trigger) return;
    e.preventDefault();
    e.stopPropagation();
    trigger();
  };

  return (
    <SplitLabelContextMenu>
      <HeaderIsland class="shrink" onClick={openTitleFileMenu}>
        <div class="ph-no-capture z-split-header-content relative flex items-center gap-2 min-w-0 max-w-full h-full shrink">
          <Show
            when={suppliedIcon.toArray().length > 0}
            fallback={
              <EntityIcon
                class="shrink-0"
                targetType={props.targetType}
                appearance={props.appearance}
                size="xs"
              />
            }
          >
            {suppliedIcon()}
          </Show>
          <Show when={props.badges}>{props.badges}</Show>
          <Show
            when={props.title}
            fallback={
              <Show
                when={props.document}
                fallback={
                  <SplitLabel
                    label={props.name}
                    lockRename={props.lockRename}
                  />
                }
              >
                {(document) => (
                  <DocumentTitleHoverCard
                    documentId={document().documentId}
                    name={props.name}
                    ownerId={document().ownerId}
                    createdAt={document().createdAt}
                    updatedAt={document().updatedAt}
                  >
                    <SplitLabel
                      label={props.name}
                      lockRename={props.lockRename}
                    />
                  </DocumentTitleHoverCard>
                )}
              </Show>
            }
          >
            {(title) => title()}
          </Show>
          {props.trailingBadges}
          <div
            class="shrink-0 flex items-center h-full"
            ref={titleFileMenuMount(panel)}
          />
        </div>
      </HeaderIsland>
    </SplitLabelContextMenu>
  );
}

/** Reads the title, icon, owner, and hover-card metadata from the legacy Block. */
export function BlockItemSplitLabel(props: {
  icon?: JSX.Element;
  fallbackName?: string;
  name?: Accessor<string | undefined>;
  lockRename?: boolean;
  badges?: JSX.Element;
  /** Rendered after the file name. */
  trailingBadges?: JSX.Element;
  /** Replaces the static name, e.g. with an inline title editor. */
  title?: JSX.Element;
}) {
  if (!isInBlock())
    throw new Error('<BlockItemSplitLabel> must be used within a Block');

  const fileName = useBlockDocumentName(props.fallbackName);
  const displayName = () => props.name?.() ?? fileName();
  const blockName = useBlockAliasedName();
  const isOwner = useIsDocumentOwner();

  const targetType = () => {
    if (blockName === 'unknown') {
      return blockMetadataSignal()?.fileType ?? blockName;
    }
    return blockName;
  };
  const appearance = () => {
    const metadata = blockMetadataSignal();
    return (blockName === 'md' || blockName === 'snippet') && metadata
      ? metadata.appearance
      : undefined;
  };
  const document = (): SplitLabelDocument | undefined => {
    const metadata = blockMetadataSignal();
    if (!metadata) return;
    return {
      documentId: metadata.documentId,
      ownerId: metadata.owner,
      createdAt: metadata.createdAt,
      updatedAt: metadata.updatedAt,
    };
  };

  return (
    <EntitySplitLabel
      targetType={targetType()}
      appearance={appearance()}
      name={displayName() ?? ''}
      document={document()}
      icon={props.icon}
      lockRename={!isOwner() || props.lockRename}
      badges={props.badges}
      trailingBadges={props.trailingBadges}
      title={props.title}
    />
  );
}

function SplitLabelContextMenu(props: ParentProps) {
  const [open, setOpen] = createSignal(false);
  const panel = useSplitPanelOrThrow();
  const actions = () => panel.titleFileMenuActions();
  const sections = createMemo(() => {
    const groups = actions();
    return groups ? getSplitFileMenuActionSections(groups) : [];
  });
  const hasActions = createMemo(() => sections().length > 0);

  const item = (action: () => SplitFileMenuAction) => {
    const label = () => (
      <>
        {action().label}
        <Show when={action().disabledReason}>
          <span class="block whitespace-normal text-xs text-ink-muted">
            {action().disabledReason}
          </span>
        </Show>
      </>
    );
    const children = () => action().children?.filter(Boolean) ?? [];
    return (
      <Switch>
        <Match when={action().menuItem}>
          {(component) => (
            <Dynamic
              component={component()}
              onActionComplete={() => {
                if (open()) dismissContextMenu();
              }}
            />
          )}
        </Match>
        <Match when={action().muteMenu}>
          {(menu) => <NotificationMuteMenu {...menu()} />}
        </Match>
        <Match when={action().notificationSettingsMenu}>
          {(menu) => (
            <NotificationSettingsMenu
              {...menu()}
              onActionComplete={() => {
                if (open()) dismissContextMenu();
              }}
            />
          )}
        </Match>
        <Match when={action().copy}>
          <CopyMenuItem
            icon={
              action().icon as Component<JSX.SvgSVGAttributes<SVGSVGElement>>
            }
            text={action().label}
            hotkeyToken={action().hotkeyToken}
            onCopy={async () => (await action().action?.()) !== false}
          />
        </Match>
        <Match when={children().length > 0}>
          <ContextMenu.Sub>
            <SubTrigger
              icon={
                action().icon as Component<JSX.SvgSVGAttributes<SVGSVGElement>>
              }
              text={action().label}
            />
            <ContextMenuContent submenu class="w-64">
              <Key each={children()} by={(child) => child.id ?? child.label}>
                {item}
              </Key>
            </ContextMenuContent>
          </ContextMenu.Sub>
        </Match>
        <Match when={true}>
          <MenuItem
            icon={
              action().icon as Component<JSX.SvgSVGAttributes<SVGSVGElement>>
            }
            text={label()}
            hotkeyToken={action().hotkeyToken}
            disabled={!!action().disabledReason}
            onClick={() => action().action?.()}
          />
        </Match>
      </Switch>
    );
  };

  const openOnDoubleClick = (e: MouseEvent) => {
    if (!hasActions()) return;
    const target = e.currentTarget;
    if (!target) return;
    e.preventDefault();
    e.stopPropagation();
    target.dispatchEvent(
      new MouseEvent('contextmenu', {
        bubbles: true,
        cancelable: true,
        clientX: e.clientX,
        clientY: e.clientY,
        button: 2,
      })
    );
  };

  return (
    <Show when={hasActions()} fallback={props.children}>
      <ContextMenu onOpenChange={setOpen}>
        <ContextMenu.Trigger class="contents" onDblClick={openOnDoubleClick}>
          {props.children}
        </ContextMenu.Trigger>
        <ContextMenu.Portal>
          <ContextMenuContent class="w-64">
            <Key each={sections()} by="key">
              {(section, index) => (
                <>
                  <Show when={index() > 0}>
                    <MenuSeparator />
                  </Show>
                  <Key
                    each={section().actions}
                    by={(action) => action.id ?? action.label}
                  >
                    {item}
                  </Key>
                </>
              )}
            </Key>
          </ContextMenuContent>
        </ContextMenu.Portal>
      </ContextMenu>
    </Show>
  );
}

/**
 * A ref that makes its element the split title's file menu mount until the
 * element's owner is disposed. The split outlives the views in it, so a mount
 * left behind would keep a view that has gone alive.
 */
export function titleFileMenuMount(
  panel: Pick<SplitPanelContextType, 'setTitleFileMenuRef'>
) {
  return (element: HTMLDivElement) => {
    panel.setTitleFileMenuRef(element);
    onCleanup(() =>
      panel.setTitleFileMenuRef((current) =>
        current === element ? undefined : current
      )
    );
  };
}

export function SplitTitleFileMenu(props: ParentProps) {
  const panel = useSplitPanelOrThrow();

  return (
    <Show when={panel.titleFileMenuRef()}>
      <Portal
        mount={panel.titleFileMenuRef()}
        ref={(div) => {
          div.style.display = 'contents';
        }}
      >
        {props.children}
      </Portal>
    </Show>
  );
}
