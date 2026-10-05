import { ViewBreadcrumbs } from '@app/components/view-shell';
import { useSplitDisplayName } from '@components/app/split-layout/layoutUtils';
import {
  EntityIcon,
  type EntityIconSelector,
} from '@core/component/EntityIcon';
import { fileTypeToBlockName } from '@core/constant/allBlocks';
import { useItemRawName } from '@queries/preview';
import type { ItemEntity } from '@queries/preview/types';
import { Show } from 'solid-js';
import { DocumentTitleHoverCard } from './DocumentTitleHoverCard';
import type {
  EntityDetailNavigationEntry,
  EntityDetailTarget,
} from './entity-detail-target';

function breadcrumbIcon(target: EntityDetailTarget): EntityIconSelector {
  if (target.type === 'document') {
    return (target.subType?.type ??
      target.fileType ??
      'unknown') as EntityIconSelector;
  }
  if (
    target.type === 'channel' ||
    target.type === 'channel_message' ||
    target.type === 'channel_thread'
  ) {
    return 'channel';
  }
  return fileTypeToBlockName(target.type, true);
}

function fallbackBreadcrumbName(target: EntityDetailTarget) {
  if (target.fallbackName) return target.fallbackName;

  if (target.type === 'document' && target.subType?.type === 'task') {
    return 'New Task';
  }
  if (
    target.type === 'channel' ||
    target.type === 'channel_message' ||
    target.type === 'channel_thread'
  ) {
    return 'Channel';
  }
  return 'Untitled';
}

function isReminderTarget(target: { type: string }) {
  return target.type === 'reminder';
}

function BreadcrumbItem(props: {
  entry: EntityDetailNavigationEntry;
  order: number;
  name: string;
  setsSplitDisplayName?: boolean;
}) {
  useSplitDisplayName(() =>
    props.setsSplitDisplayName ? props.name : undefined
  );

  const button = (item: { isActive: () => boolean; onSelect: () => void }) => (
    <ViewBreadcrumbs.Button
      class="gap-1.5"
      isActive={item.isActive()}
      onClick={item.onSelect}
      tooltip={props.entry.data.type === 'document' ? undefined : props.name}
    >
      <EntityIcon
        targetType={breadcrumbIcon(props.entry.data)}
        size="xs"
        class="shrink-0"
      />
      <span class="truncate">{props.name}</span>
    </ViewBreadcrumbs.Button>
  );

  return (
    <ViewBreadcrumbs.Item
      value={props.entry.value}
      metadata={props.entry.data}
      order={props.order}
    >
      {(item) => (
        <Show
          when={props.entry.data.type === 'document'}
          fallback={button(item)}
        >
          <DocumentTitleHoverCard
            documentId={props.entry.data.id}
            name={props.name}
          >
            {button(item)}
          </DocumentTitleHoverCard>
        </Show>
      )}
    </ViewBreadcrumbs.Item>
  );
}

function LiveBreadcrumbItem(props: {
  entry: EntityDetailNavigationEntry;
  order: number;
  previewItem: ItemEntity;
  setsSplitDisplayName?: boolean;
}) {
  const currentName = useItemRawName(() => props.previewItem);
  const name = () => {
    const current = currentName();
    if (current?.trim()) return current;

    return fallbackBreadcrumbName(props.entry.data);
  };

  return (
    <BreadcrumbItem
      entry={props.entry}
      order={props.order}
      name={name()}
      setsSplitDisplayName={props.setsSplitDisplayName ?? false}
    />
  );
}

export function EntityDetailBreadcrumbItem(props: {
  entry: EntityDetailNavigationEntry;
  order: number;
  setsSplitDisplayName?: boolean;
}) {
  return (
    <Show
      when={
        isReminderTarget(props.entry.data)
          ? undefined
          : ({
              id: props.entry.data.id,
              type: props.entry.data.type,
            } satisfies ItemEntity)
      }
      fallback={
        <BreadcrumbItem
          entry={props.entry}
          order={props.order}
          name={fallbackBreadcrumbName(props.entry.data)}
          setsSplitDisplayName={props.setsSplitDisplayName ?? false}
        />
      }
    >
      {(previewItem) => (
        <LiveBreadcrumbItem
          entry={props.entry}
          order={props.order}
          previewItem={previewItem()}
          setsSplitDisplayName={props.setsSplitDisplayName ?? false}
        />
      )}
    </Show>
  );
}
