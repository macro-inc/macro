import { useItemPreviewData } from '@core/component/ItemPreview';
import { UserIcon } from '@core/component/UserIcon';
import { type DateValue, formatDate } from '@core/util/date';
import type { NamedSubType } from '@entity';
import { type ItemEntity, isAccessiblePreviewItem } from '@queries/preview';
import type { ItemType } from '@service-storage/client';
import { Show } from 'solid-js';

export type AttachmentEntityRowData = {
  entityId: string;
  entityType: ItemType;
  senderId?: string;
  timestamp?: DateValue | null;
};

/**
 * A single document-attachment row. Resolves the referenced entity by id
 * through the shared preview dataloader (access-aware, not scoped to the
 * viewer's recent soup), so every attachment the viewer can open shows up.
 * Inaccessible / deleted entities resolve to a non-`access` state and are
 * hidden rather than rendered as broken rows.
 */
export function AttachmentEntityRow(props: AttachmentEntityRowData) {
  const entity = (): ItemEntity =>
    props.entityType === 'channel'
      ? { id: props.entityId, type: 'channel' }
      : { id: props.entityId, type: props.entityType };

  const { item, name, onPreviewClick, ItemEntityIcon } =
    useItemPreviewData(entity);

  const accessibleItem = () => {
    const it = item();
    return isAccessiblePreviewItem(it) ? it : undefined;
  };

  return (
    <Show when={accessibleItem()}>
      {(accessible) => (
        <button
          type="button"
          class="flex items-center gap-2 min-h-10 px-6 text-sm hover:bg-hover w-full text-left"
          onClick={(e) => {
            const it = accessible();
            onPreviewClick(
              it.type,
              it.id,
              it.fileType,
              it.subType?.type as NamedSubType | undefined,
              e.shiftKey
            );
          }}
        >
          <div class="size-4 shrink-0">
            <ItemEntityIcon size="fill" />
          </div>
          <span class="ph-no-capture font-semibold truncate flex-1 min-w-0">
            {name()}
          </span>
          <Show when={props.senderId}>
            {(id) => (
              <div class="shrink-0">
                <UserIcon id={id()} size="sm" suppressClick showTooltip />
              </div>
            )}
          </Show>
          <span class="text-xs text-ink-extra-muted font-light shrink-0">
            <Show when={props.timestamp}>{(ts) => formatDate(ts())}</Show>
          </span>
        </button>
      )}
    </Show>
  );
}
