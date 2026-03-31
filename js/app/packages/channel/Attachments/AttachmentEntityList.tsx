import { type Accessor, createMemo, For, Show } from 'solid-js';
import type { ApiChannelAttachment } from '@service-comms/client';
import { useSoupItemsQuery } from '@queries/soup/items';
import type { EntityData } from '@entity';
import { useSplitLayout } from '@app/component/split-layout/layout';
import {
  isDocumentAttachment,
  buildAttachmentEntityFilters,
  getEntityClickContent,
} from './attachment-utils';
import { SectionHeader, LoadMoreButton } from './SectionHeader';
import { AttachmentEntityRow } from './AttachmentEntityRow';

export function AttachmentEntityList(props: {
  attachments: Accessor<ApiChannelAttachment[]>;
  hasNextPage: Accessor<boolean>;
  isFetchingNextPage: Accessor<boolean>;
  onLoadMore: () => void;
}) {
  const documentAttachments = createMemo(() =>
    props.attachments().filter(isDocumentAttachment)
  );
  const hasDocuments = () => documentAttachments().length > 0;

  const soupQuery = useSoupItemsQuery(
    () => ({
      params: { limit: 500 },
      body: buildAttachmentEntityFilters(documentAttachments()),
    }),
    () => ({ enabled: hasDocuments() })
  );

  const attachmentByEntityId = createMemo(() => {
    const map = new Map<string, ApiChannelAttachment>();
    for (const a of documentAttachments()) map.set(a.entity_id, a);
    return map;
  });

  const sortedEntities = () => {
    const entities = soupQuery.data ?? [];
    const lookup = attachmentByEntityId();
    return [...entities].sort((a, b) => {
      const aTime = lookup.get(a.id)?.created_at ?? '';
      const bTime = lookup.get(b.id)?.created_at ?? '';
      return bTime.localeCompare(aTime);
    });
  };

  const { replaceOrInsertSplit } = useSplitLayout();
  const handleEntityClick = (entity: EntityData) =>
    replaceOrInsertSplit(getEntityClickContent(entity));

  return (
    <div class="flex flex-col">
      <SectionHeader label="Documents" />

      <Show when={!hasDocuments()}>
        <div class="text-sm text-ink-faint px-2 py-3">
          No documents in this channel yet.
        </div>
      </Show>

      <Show when={hasDocuments()}>
          <For each={sortedEntities()}>
            {(entity) => {
              const attachment = attachmentByEntityId().get(entity.id);
              return (
                <AttachmentEntityRow
                  entity={entity}
                  timestamp={attachment?.created_at}
                  senderId={attachment?.sender_id}
                  onClick={() => handleEntityClick(entity)}
                />
              );
            }}
          </For>
      </Show>

      <Show when={hasDocuments() && props.hasNextPage()}>
        <LoadMoreButton
          onLoadMore={props.onLoadMore}
          isFetching={props.isFetchingNextPage}
        />
      </Show>
    </div>
  );
}
