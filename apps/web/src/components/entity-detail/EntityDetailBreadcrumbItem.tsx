import { ViewBreadcrumbs } from '@app/components/view-shell';
import {
  EntityIcon,
  type EntityIconSelector,
} from '@core/component/EntityIcon';
import { fileTypeToBlockName } from '@core/constant/allBlocks';
import { useItemRawName } from '@queries/preview';
import type { ItemEntity } from '@queries/preview/types';
import { Show } from 'solid-js';
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

function BreadcrumbItem(props: {
  entry: EntityDetailNavigationEntry;
  order: number;
  name: string;
}) {
  return (
    <ViewBreadcrumbs.Item
      value={props.entry.value}
      metadata={props.entry.data}
      order={props.order}
    >
      {(item) => (
        <ViewBreadcrumbs.Button
          class="gap-1.5"
          isActive={item.isActive()}
          onClick={item.onSelect}
          tooltip={props.name}
        >
          <EntityIcon
            targetType={breadcrumbIcon(props.entry.data)}
            size="xs"
            class="shrink-0"
          />
          <span class="truncate">{props.name}</span>
        </ViewBreadcrumbs.Button>
      )}
    </ViewBreadcrumbs.Item>
  );
}

function LiveBreadcrumbItem(props: {
  entry: EntityDetailNavigationEntry;
  order: number;
  previewItem: ItemEntity;
}) {
  const currentName = useItemRawName(() => props.previewItem);
  const name = () => {
    const current = currentName();
    if (current?.trim()) return current;

    return fallbackBreadcrumbName(props.entry.data);
  };

  return (
    <BreadcrumbItem entry={props.entry} order={props.order} name={name()} />
  );
}

export function EntityDetailBreadcrumbItem(props: {
  entry: EntityDetailNavigationEntry;
  order: number;
}) {
  return (
    <Show
      when={
        props.entry.data.type === 'reminder'
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
        />
      }
    >
      {(previewItem) => (
        <LiveBreadcrumbItem
          entry={props.entry}
          order={props.order}
          previewItem={previewItem()}
        />
      )}
    </Show>
  );
}
