import { type DateValue, formatDate } from '@core/util/date';
import { OwnerLabel } from '@entity/owner/owner-display';
import { type ParentProps, Show } from 'solid-js';

export function EntityMetadataRow(props: ParentProps<{ label: string }>) {
  return (
    <div class="flex min-w-0 items-center gap-3">
      <span class="w-(--sidepanel-label-width) shrink-0 whitespace-nowrap">
        {props.label}
      </span>
      <div class="min-w-0 flex-1 wrap-break-word">{props.children}</div>
    </div>
  );
}

/** Quiet metadata copy shared by every block information panel. */
export function EntityMetadata(
  props: ParentProps<{
    ownerId?: string | null;
    createdAt?: DateValue | null;
    updatedAt?: DateValue | null;
  }>
) {
  return (
    <div class="flex flex-col gap-2">
      <Show when={props.ownerId}>
        {(owner) => (
          <EntityMetadataRow label="Owner">
            <OwnerLabel ownerId={owner()} textOnly suppressClick />
          </EntityMetadataRow>
        )}
      </Show>
      <Show when={props.createdAt}>
        {(created) => (
          <EntityMetadataRow label="Created">
            {formatDate(created(), { showTime: true })}
          </EntityMetadataRow>
        )}
      </Show>
      <Show when={props.updatedAt}>
        {(updated) => (
          <EntityMetadataRow label="Last updated">
            {formatDate(updated(), { showTime: true })}
          </EntityMetadataRow>
        )}
      </Show>
      {props.children}
    </div>
  );
}
