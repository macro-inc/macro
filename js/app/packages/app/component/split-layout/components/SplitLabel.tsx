import { isInBlock, useBlockAliasedName, useBlockId } from '@core/block';
import {
  EntityIcon,
  type EntityIconSelector,
  isArchiveType,
} from '@core/component/EntityIcon';
import { toast } from '@core/component/Toast/Toast';
import { Tooltip } from '@core/component/Tooltip';
import { blockMetadataSignal } from '@core/signal/load';
import {
  useCanComment,
  useCanEdit,
  useCanView,
  useIsDocumentOwner,
} from '@core/signal/permissions';
import { useBlockDocumentName } from '@core/util/currentBlockDocumentName';
import { buildEntityData, type BuildEntityDataArgs } from '@entity';
import { createEffect, type JSX, Show } from 'solid-js';
import { openBulkEditModal } from '@app/component/bulk-edit-entity/BulkEditEntityModal';
import { useSplitPanelOrThrow } from '../layoutUtils';
import { cn } from '@ui/utils/classname';

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
  );
}

export function SplitLabel(props: {
  label: string;
  lockRename?: boolean;
  /** Per-variant fields the block context can't supply (e.g. `channelType`
   * for a channel rename). Merged into the args passed to `buildEntityData`. */
  renameOverrides?: Partial<BuildEntityDataArgs>;
}) {
  const panel = useSplitPanelOrThrow();
  const blockId = useBlockId();
  const aliasedBlockName = useBlockAliasedName();

  createEffect(() => {
    panel.handle.setDisplayName(props.label);
  });

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
      {props.label}
    </span>
  );
}

export function SplitHeaderBadge(props: { text: string; tooltip?: string }) {
  return (
    <span class="py-0.5 px-2 rounded-none text-xxs text-ink-muted">
      <Tooltip tooltip={props.tooltip} spanMode>
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
  lockRename?: boolean;
  badges?: JSX.Element;
}) {
  const panel = useSplitPanelOrThrow();
  if (!isInBlock())
    throw new Error('<BlockItemSplitLabel> must be used within a Block');

  const fileName = useBlockDocumentName(props.fallbackName);
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
    panel.handle.setDisplayName(fileName());
  });

  return (
    <div class="ph-no-capture z-page-overlay relative flex items-center gap-2 w-screen max-w-full h-full shrink">
      <EntityIcon class="shrink-0" targetType={targetType()} size="xs" />
      <Show when={props.badges}>{props.badges}</Show>
      <SplitLabel
        label={fileName()}
        lockRename={!isOwner() || props.lockRename}
      />
    </div>
  );
}
