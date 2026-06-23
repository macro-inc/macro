import { openBulkEditModal } from '@app/component/bulk-edit-entity/BulkEditEntityModal';
import { useSidePanel } from '@app/component/side-panel/SidePanel';
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
import ArticleIcon from '@phosphor/article.svg';
import InfoIcon from '@phosphor/info.svg';
import { cn, Tooltip } from '@ui';
import { type Accessor, createEffect, type JSX, Show } from 'solid-js';
import { useSplitPanelOrThrow } from '../layoutUtils';
import { HeaderIsland } from './HeaderIsland';
import { HeaderTitleMenu, type HeaderTitleMenuItem } from './HeaderTitleMenu';

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
  return (
    <HeaderIsland class="shrink">
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
        <span class="inline-block text-sm truncate">{props.label}</span>
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
    if (e.type === 'contextmenu') e.preventDefault();

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

  return (
    <span
      class="inline-block text-sm truncate"
      onContextMenu={startEditing}
      onDblClick={startEditing}
    >
      {truncatedLabel()}
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

  const sidePanel = useSidePanel();

  return (
    <HeaderIsland class="shrink">
      <Show
        when={isMobile() && sidePanel?.hasSections()}
        fallback={
          <div class="ph-no-capture z-page-overlay relative flex items-center gap-2 min-w-0 max-w-full h-full shrink">
            <EntityIcon class="shrink-0" targetType={targetType()} size="xs" />
            <Show when={props.badges}>{props.badges}</Show>
            <SplitLabel
              label={displayName() ?? ''}
              lockRename={!isOwner() || props.lockRename}
            />
          </div>
        }
      >
        {/* Mobile: the side-panel tabs hide behind the title — tapping it
            opens a menu switching between Content and Info. */}
        <HeaderTitleMenu
          items={SIDE_PANEL_VIEWS}
          active={sidePanel?.isOpen() ? 'info' : 'content'}
          onSelect={(value) => sidePanel?.setIsOpen(value === 'info')}
        >
          <EntityIcon class="shrink-0" targetType={targetType()} size="xs" />
          <Show when={props.badges}>{props.badges}</Show>
          <SplitLabel
            label={displayName() ?? ''}
            lockRename={!isOwner() || props.lockRename}
          />
        </HeaderTitleMenu>
      </Show>
    </HeaderIsland>
  );
}

const SIDE_PANEL_VIEWS: HeaderTitleMenuItem[] = [
  { value: 'content', label: 'Content', icon: ArticleIcon },
  { value: 'info', label: 'Info', icon: InfoIcon },
];
