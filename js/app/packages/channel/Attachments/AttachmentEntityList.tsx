import { For, Show } from 'solid-js';
import type { EntityData } from '@entity';
import type { DateValue } from '@core/util/date';
import { SectionHeader, LoadMoreButton } from './SectionHeader';
import { AttachmentEntityRow } from './AttachmentEntityRow';

export type AttachmentEntityListRow = {
  entity: EntityData;
  timestamp?: DateValue | null;
  senderId?: string;
  onClick?: () => void;
};

export function AttachmentEntityList(props: {
  rows: AttachmentEntityListRow[];
  hasNextPage: boolean;
  isFetchingNextPage: boolean;
  onLoadMore: () => void;
}) {
  const hasDocuments = () => props.rows.length > 0;

  return (
    <div class="flex flex-col">
      <SectionHeader label="Documents" />

      <Show when={!hasDocuments()}>
        <div class="text-sm text-ink-faint px-2 py-3">
          No documents in this channel yet.
        </div>
      </Show>

      <Show when={hasDocuments()}>
        <For each={props.rows}>
          {(row) => (
            <AttachmentEntityRow
              entity={row.entity}
              timestamp={row.timestamp}
              senderId={row.senderId}
              onClick={row.onClick}
            />
          )}
        </For>
      </Show>

      <Show when={hasDocuments() && props.hasNextPage}>
        <LoadMoreButton
          onLoadMore={props.onLoadMore}
          isFetching={() => props.isFetchingNextPage}
        />
      </Show>
    </div>
  );
}
