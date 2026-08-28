import { isInBlock, useBlockAliasedName } from '@core/block';
import {
  ContextMenuContent,
  MenuItem,
  MenuSeparator,
  SubTrigger,
} from '@core/component/ContextMenu';
import {
  EntityIcon,
  type EntityIconSelector,
  isArchiveType,
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
import type { BuildEntityDataArgs } from '@entity';
import { ContextMenu } from '@kobalte/core/context-menu';
import CaretDownIcon from '@phosphor/caret-down.svg';
import { cn, Tooltip } from '@ui';
import {
  type Accessor,
  type Component,
  createEffect,
  createMemo,
  For,
  type JSX,
  type ParentProps,
  Show,
} from 'solid-js';
import { Portal } from 'solid-js/web';
import {
  getSplitFileMenuActionSections,
  type SplitFileMenuAction,
} from '../context';
import { useSplitPanelOrThrow } from '../layoutUtils';
import { HeaderIsland } from './HeaderIsland';

export function StaticSplitLabel(props: {
  label: string;
  iconType?: EntityIconSelector;
  icon?: JSX.Element;
  badges?: JSX.Element;
  class?: string;
  colorIcon?: boolean;
  /** Enables in-place editing while retaining the split title/menu chrome. */
  onRename?: (name: string) => void;
  renameAriaLabel?: string;
}) {
  const panel = useSplitPanelOrThrow();
  createEffect(() => {
    panel.handle.setDisplayName(props.label);
  });
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
            'z-split-header-content relative flex items-center gap-2 max-w-full h-full shrink',
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
            <div class="shrink-0">{props.icon}</div>
          </Show>
          <Show when={props.badges}>{props.badges}</Show>
          <span class="inline-flex min-w-0 items-center gap-1">
            <Show
              when={props.onRename}
              fallback={
                <span class="inline-block truncate text-sm font-semibold">
                  {props.label}
                </span>
              }
            >
              {(onRename) => (
                <span onClick={(event) => event.stopPropagation()}>
                  <InlineTitleEditor
                    value={props.label}
                    placeholder="Untitled"
                    ariaLabel={props.renameAriaLabel ?? 'Rename'}
                    onRename={onRename()}
                    class="text-sm"
                  />
                </span>
              )}
            </Show>
            <Show when={panel.titleFileMenuTrigger()}>
              <CaretDownIcon class="hidden size-3.5 shrink-0 text-ink-muted touch:block" />
            </Show>
          </span>
          <div
            class="shrink-0 flex items-center h-full"
            ref={(ref) => {
              panel.setTitleFileMenuRef(ref);
            }}
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

  createEffect(() => {
    panel.handle.setDisplayName(props.label);
  });

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

export function SplitPermissionsBadge() {
  const canEdit = useCanEdit();
  const canComment = useCanComment();
  const canView = useCanView();
  const showBadge = () => !canEdit();

  const tooltip = () => {
    if (!canView()) return 'No Access';
    if (canComment()) return 'Comment Only';
    return 'View Only';
  };

  const text = () => {
    if (!canView()) return 'no access';
    if (canComment()) return 'comment only';
    return 'viewer';
  };

  return (
    <Show when={showBadge()}>
      <SplitHeaderBadge text={text()} tooltip={tooltip()} />
    </Show>
  );
}

export function BlockItemSplitLabel(props: {
  fallbackName?: string;
  name?: Accessor<string | undefined>;
  lockRename?: boolean;
  badges?: JSX.Element;
}) {
  const panel = useSplitPanelOrThrow();
  if (!isInBlock())
    throw new Error('<BlockItemSplitLabel> must be used within a Block');

  const fileName = useBlockDocumentName(props.fallbackName);
  const displayName = () => props.name?.() ?? fileName();
  const blockName = useBlockAliasedName();
  const isOwner = useIsDocumentOwner();

  const targetType = () => {
    // archive files have a special icon
    if (blockName === 'unknown') {
      const fileType = blockMetadataSignal()?.fileType;
      if (fileType && isArchiveType(fileType)) {
        return 'archive';
      }
    }
    return blockName;
  };

  createEffect(() => {
    panel.handle.setDisplayName(displayName());
  });

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
          <EntityIcon class="shrink-0" targetType={targetType()} size="xs" />
          <Show when={props.badges}>{props.badges}</Show>
          <SplitLabel
            label={displayName() ?? ''}
            lockRename={!isOwner() || props.lockRename}
          />
          <div
            class="shrink-0 flex items-center h-full"
            ref={(ref) => {
              panel.setTitleFileMenuRef(ref);
            }}
          />
        </div>
      </HeaderIsland>
    </SplitLabelContextMenu>
  );
}

function SplitLabelContextMenu(props: ParentProps) {
  const panel = useSplitPanelOrThrow();
  const actions = () => panel.titleFileMenuActions();
  const sections = createMemo(() => {
    const groups = actions();
    return groups ? getSplitFileMenuActionSections(groups) : [];
  });
  const hasActions = createMemo(() => sections().length > 0);

  const item = (action: SplitFileMenuAction) => {
    const children = () => action.children?.filter(Boolean) ?? [];

    return (
      <Show
        when={children().length > 0}
        fallback={
          <MenuItem
            icon={action.icon as Component<JSX.SvgSVGAttributes<SVGSVGElement>>}
            text={action.label}
            hotkeyToken={action.hotkeyToken}
            onClick={() => action.action?.()}
          />
        }
      >
        <ContextMenu.Sub>
          <SubTrigger
            icon={action.icon as Component<JSX.SvgSVGAttributes<SVGSVGElement>>}
            text={action.label}
          />
          <ContextMenuContent submenu class="w-64">
            <For each={children()}>{item}</For>
          </ContextMenuContent>
        </ContextMenu.Sub>
      </Show>
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
      <ContextMenu>
        <ContextMenu.Trigger class="contents" onDblClick={openOnDoubleClick}>
          {props.children}
        </ContextMenu.Trigger>
        <ContextMenu.Portal>
          <ContextMenuContent class="w-64">
            <For each={sections()}>
              {(section, index) => (
                <>
                  <Show when={index() > 0}>
                    <MenuSeparator />
                  </Show>
                  <For each={section.actions}>{item}</For>
                </>
              )}
            </For>
          </ContextMenuContent>
        </ContextMenu.Portal>
      </ContextMenu>
    </Show>
  );
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
