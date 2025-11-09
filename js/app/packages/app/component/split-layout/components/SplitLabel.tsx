import { isInBlock, useBlockId, useBlockName } from '@core/block';
import {
  EntityIcon,
  type EntityIconSelector,
} from '@core/component/EntityIcon';
import { Tooltip } from '@core/component/Tooltip';
import {
  useCanComment,
  useCanEdit,
  useCanView,
  useIsDocumentOwner,
} from '@core/signal/permissions';
import { useBlockDocumentName } from '@core/util/currentBlockDocumentName';
import { blockNameToItemType, type ItemType } from '@service-storage/client';
import { createEffect, type JSX, Show } from 'solid-js';
import { useSplitPanelOrThrow } from '../layoutUtils';
import { useRenameSplit } from './SplitModalContext';

export function StaticSplitLabel(props: {
  label: string;
  iconType?: EntityIconSelector;
  icon?: JSX.Element;
  badges?: JSX.Element;
}) {
  const panel = useSplitPanelOrThrow();
  createEffect(() => {
    panel.handle.setDisplayName(props.label);
  });
  return (
    <div class="z-3 relative flex items-center gap-2 border-y border-edge-muted w-screen max-w-full h-full shrink">
      <Show when={props.iconType}>
        <EntityIcon targetType={props.iconType} size="xs" theme="monochrome" />
      </Show>
      <Show when={props.icon}>{props.icon}</Show>
      <Show when={props.badges}>{props.badges}</Show>
      <span class="inline-block text-sm truncate">{props.label}</span>
    </div>
  );
}

function SplitLabel(props: {
  label: string;
  onNameChanged?: (newName: string) => void;
  lockRename?: boolean;
  id?: string;
  itemType?: ItemType;
}) {
  const rename = useRenameSplit();
  const blockName = useBlockName();
  const blockId = useBlockId();

  const startEditing = (e: MouseEvent) => {
    if (props.lockRename) return;
    if (e.type === 'contextmenu') {
      e.preventDefault();
    }

    if (props.id || props.itemType || blockNameToItemType(blockName)) {
      const id = props.id || blockId;
      const itemType = props.itemType || blockNameToItemType(blockName);

      if (id && itemType) {
        rename({
          id,
          currentName: props.label,
          itemType,
          onRename: props.onNameChanged,
        });
      }
    }
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
    <span class="mx-1 p-0.5 px-2 border border-edge-muted rounded-full text-[0.625rem] text-ink-muted">
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
  const blockName = useBlockName();
  const isOwner = useIsDocumentOwner();

  createEffect(() => {
    panel.handle.setDisplayName(fileName());
  });

  return (
    <div class="z-3 relative flex items-center gap-2 border-y border-edge-muted w-screen max-w-full h-full shrink">
      <EntityIcon targetType={blockName} size="xs" />
      <Show when={props.badges}>{props.badges}</Show>
      <SplitLabel
        label={fileName()}
        lockRename={!isOwner() || props.lockRename}
      />
    </div>
  );
}
