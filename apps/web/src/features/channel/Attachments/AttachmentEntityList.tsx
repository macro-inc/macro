import type { DateValue } from '@core/util/date';
import type { EntityData } from '@entity';
import type { ApiChannelAttachment } from '@service-storage/generated/schemas/apiChannelAttachment';
import { For, Show } from 'solid-js';
import { match } from 'ts-pattern';
import { AttachmentChipRow } from './AttachmentChipRow';
import { AttachmentEntityRow } from './AttachmentEntityRow';
import { AttachmentSection, LoadMoreButton } from './SectionHeader';

export type AttachmentEntityListRow =
  | {
      kind: 'entity';
      entity: EntityData;
      timestamp?: DateValue | null;
      senderId?: string;
      onClick?: (event: MouseEvent) => void;
    }
  | { kind: 'attachment'; attachment: ApiChannelAttachment };

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
      class={hasDocuments() ? 'flex-1' : undefined}
    >
      <div class="grid grid-cols-1">
        <Show when={!hasDocuments()}>
          <div class="px-6 py-3 text-sm text-ink-subtle">
            No documents in this channel yet.
          </div>
        </Show>

        <Show when={hasDocuments()}>
          <For each={props.rows}>
            {(row) =>
              match(row)
                .with({ kind: 'entity' }, (entityRow) => (
                  <AttachmentEntityRow
                    entity={entityRow.entity}
                    timestamp={entityRow.timestamp}
                    senderId={entityRow.senderId}
                    onClick={entityRow.onClick}
                  />
                ))
                .with({ kind: 'attachment' }, (attachmentRow) => (
                  <AttachmentChipRow attachment={attachmentRow.attachment} />
                ))
                .exhaustive()
            }
          </For>

          <Show when={props.hasNextPage}>
            <LoadMoreButton
              onLoadMore={props.onLoadMore}
              isFetching={() => props.isFetchingNextPage}
            />
          </Show>
        </Show>
      </div>
    </AttachmentSection>
  );
}
