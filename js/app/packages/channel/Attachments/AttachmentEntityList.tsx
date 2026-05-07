import type { DateValue } from '@core/util/date';
import type { EntityData } from '@entity';
import { For, Show } from 'solid-js';
import { AttachmentEntityRow } from './AttachmentEntityRow';
import { AttachmentSection, LoadMoreButton } from './SectionHeader';

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
    <AttachmentSection
      label="Documents"
      class="flex flex-1 min-h-0 flex-col md:flex-none"
      contentClass="flex flex-1 min-h-0 flex-col"
    >
      <div class="flex flex-1 min-h-0 flex-col">
        <Show when={!hasDocuments()}>
          <div class="py-3 text-sm text-ink-faint">
            No documents in this channel yet.
          </div>
        </Show>

        <Show when={hasDocuments()}>
          <div class="min-h-0 h-full overflow-y-auto md:h-105">
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

            <Show when={props.hasNextPage}>
              <LoadMoreButton
                onLoadMore={props.onLoadMore}
                isFetching={() => props.isFetchingNextPage}
              />
            </Show>
          </div>
        </Show>
      </div>
    </AttachmentSection>
  );
}
