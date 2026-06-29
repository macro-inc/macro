import { openBulkEditModal } from '@app/component/bulk-edit-entity/BulkEditEntityModal';
import { isInBlock, useBlockAliasedName, useBlockId } from '@core/block';
import {
  EntityIcon,
  type EntityIconSelector,
  isArchiveType,
} from '@core/component/EntityIcon';
import { toast } from '@core/component/Toast/Toast';
import { isMobile } from '@core/mobile/isMobile';
import { blockMetadataSignal } from '@core/signal/load';
import {
  useCanComment,
  useCanEdit,
  useCanView,
  useIsDocumentOwner,
} from '@core/signal/permissions';
import { useBlockDocumentName } from '@core/util/currentBlockDocumentName';
import { type BuildEntityDataArgs, buildEntityData } from '@entity';
import CaretDownIcon from '@phosphor/caret-down.svg';
import { cn, Tooltip } from '@ui';
import {
  type Accessor,
  createEffect,
  type JSX,
  type ParentProps,
  Show,
} from 'solid-js';
import { Portal } from 'solid-js/web';
import { useSplitPanelOrThrow } from '../layoutUtils';
import { HeaderIsland } from './HeaderIsland';

export function StaticSplitLabel(props: {
  label: string;
  iconType?: EntityIconSelector;
  icon?: JSX.Element;
  badges?: JSX.Element;
  class?: string;
  colorIcon?: boolean;
}) {
  const panel = useSplitPanelOrThrow();
  createEffect(() => {
    panel.handle.setDisplayName(props.label);
  });
  const openTitleFileMenu = (e: MouseEvent) => {
    if (!isMobile()) return;
    const trigger = panel.titleFileMenuTrigger();
    if (!trigger) return;
    e.preventDefault();
    e.stopPropagation();
    trigger();
  };
  return (
    <HeaderIsland
      class={cn('shrink', panel.titleFileMenuTrigger() && 'cursor-pointer')}
      onClick={openTitleFileMenu}
    >
      <div
        class={cn(
          'z-page-overlay relative flex items-center gap-2 max-w-full h-full shrink',
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
          <span class="inline-block truncate text-sm font-semibold">
            {props.label}
          </span>
          <Show when={panel.titleFileMenuTrigger()}>
            <CaretDownIcon class="hidden size-3.5 shrink-0 text-ink-muted mobile:block" />
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
  const blockId = useBlockId();
  const aliasedBlockName = useBlockAliasedName();

  createEffect(() => {
    panel.handle.setDisplayName(props.label);
  });

  const truncatedLabel = () => {
    if (!props.maxDisplayLength) return props.label;
    if (props.label.length <= props.maxDisplayLength) return props.label;
    return props.label.slice(0, props.maxDisplayLength - 3) + '...';
  };

  const startEditing = (e: MouseEvent) => {
    if (props.lockRename) return;
    if (e.type === 'contextmenu') {
      e.preventDefault();
      e.stopPropagation();
    }

    const entity = buildEntityData({
      id: blockId,
      name: props.label,
      blockName: aliasedBlockName,
      ...props.renameOverrides,
    });
    if (!entity) return;

    openBulkEditModal({
      view: 'rename',
      entities: [entity],
      onFinish: () => toast.success('Renamed'),
      onError: () => toast.failure('Failed to rename'),
    });
  };

  const openTitleFileMenu = (e: MouseEvent) => {
    if (!isMobile()) return;
    const trigger = panel.titleFileMenuTrigger();
    if (!trigger) return;
    e.preventDefault();
    e.stopPropagation();
    trigger();
  };

  return (
    <span class="flex min-w-0 items-center gap-1" onClick={openTitleFileMenu}>
      <span
        class="inline-block truncate text-sm font-semibold"
        onContextMenu={startEditing}
        onDblClick={startEditing}
      >
        {truncatedLabel()}
      </span>
      <Show when={panel.titleFileMenuTrigger()}>
        <CaretDownIcon class="hidden size-4 shrink-0 text-ink-muted mobile:block" />
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
    if (!isMobile()) return;
    const trigger = panel.titleFileMenuTrigger();
    if (!trigger) return;
    e.preventDefault();
    e.stopPropagation();
    trigger();
  };

  return (
    <HeaderIsland
      class={cn('shrink', panel.titleFileMenuTrigger() && 'cursor-pointer')}
      onClick={openTitleFileMenu}
    >
      <div class="ph-no-capture z-page-overlay relative flex items-center gap-2 min-w-0 max-w-full h-full shrink">
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
