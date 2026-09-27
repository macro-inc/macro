import {
  compileToAst,
  defineQueryFilters,
  type Query,
  queryStateFrom,
} from '@app/features/next-soup/filters/filter-store';
import { ProjectAttachment } from '@app/features/projects/project-attachment';
import { useFeatureFlag } from '@app/lib/analytics/posthog';
import { useSplitLayout } from '@components/app/split-layout/layout';
import { enableProjects } from '@core/constant/featureFlags';
import type { EntityData } from '@entity';
import {
  type ChannelAttachmentsData,
  flattenAttachments,
  useChannelDocumentAttachmentsQuery,
} from '@queries/channel/channel-attachments';
import { useSoupAstItemsQuery } from '@queries/soup/items';
import { stringToItemType } from '@service-storage/client';
import type { ApiChannelAttachment } from '@service-storage/generated/schemas/apiChannelAttachment';
import { createMemo, For, Show } from 'solid-js';
import {
  AttachmentEntityList,
  type AttachmentEntityListRow,
} from './AttachmentEntityList';
import { getEntityClickContent } from './attachment-utils';
import { AttachmentSection, LoadMoreButton } from './SectionHeader';

/**
 * Scope a soup query to exactly the attachment entities. `defineQueryFilters`
 * NIL-fills every entity type we don't reference, so soup never fans out to
 * crm companies or foreign entities (which it would otherwise fetch unfiltered).
 */
function attachmentSoupAst(attachments: ApiChannelAttachment[]) {
  const documentId: string[] = [];
  const threadId: string[] = [];
  const chatId: string[] = [];
  const channelId: string[] = [];
  const folderId: string[] = [];
  const callId: string[] = [];

  for (const a of attachments) {
    switch (stringToItemType(a.entity_type)) {
      case 'document':
        documentId.push(a.entity_id);
        break;
      case 'email':
        threadId.push(a.entity_id);
        break;
      case 'chat':
        chatId.push(a.entity_id);
        break;
      case 'channel':
        channelId.push(a.entity_id);
        break;
      case 'project':
        folderId.push(a.entity_id);
        break;
      case 'call':
        callId.push(a.entity_id);
        break;
    }
  }

  const include: NonNullable<Query['include']> = {};
  if (documentId.length) include.documentId = documentId;
  if (threadId.length) include.threadId = threadId;
  if (chatId.length) include.chatId = chatId;
  if (channelId.length) include.channelId = channelId;
  if (folderId.length) include.folderId = folderId;
  if (callId.length) include.callId = callId;

  return compileToAst(queryStateFrom(defineQueryFilters({ include })));
}

export function ChannelAttachmentEntitySection(props: { channelId: string }) {
  const projectsFlag = useFeatureFlag(enableProjects);
  const attachmentsQuery = useChannelDocumentAttachmentsQuery(
    () => props.channelId
  );

  const documentAttachments = createMemo(() =>
    flattenAttachments(
      attachmentsQuery.isSuccess
        ? (attachmentsQuery.data as ChannelAttachmentsData)
        : undefined
    )
  );

  const projectAttachments = createMemo(() => [
    ...new Set(
      documentAttachments()
        .filter((item) => item.entity_type === 'initiative')
        .map((item) => item.entity_id)
    ),
  ]);
  const soupQuery = useSoupAstItemsQuery(
    () => ({
      params: { limit: 500 },
      body: attachmentSoupAst(documentAttachments()),
    }),
    () => ({
      enabled: documentAttachments().some(
        (item) => item.entity_type !== 'initiative'
      ),
    })
  );

  const attachmentByEntityId = createMemo(() => {
    const map = new Map<string, ApiChannelAttachment>();
    for (const attachment of documentAttachments()) {
      map.set(attachment.entity_id, attachment);
    }
    return map;
  });

  const { openWithSplit } = useSplitLayout();
  const handleEntityClick = (entity: EntityData, event: MouseEvent) =>
    openWithSplit(getEntityClickContent(entity), {
      activate: true,
      preferNewSplit: event.shiftKey,
    });

  const rows = createMemo<AttachmentEntityListRow[]>(() => {
    const entities = soupQuery.isLoading
      ? []
      : (soupQuery.data?.entities ?? []);
    const lookup = attachmentByEntityId();

    return [...entities]
      .sort((a, b) => {
        const aTime = lookup.get(a.id)?.created_at ?? '';
        const bTime = lookup.get(b.id)?.created_at ?? '';
        return bTime.localeCompare(aTime);
      })
      .map((entity) => {
        const attachment = lookup.get(entity.id);
        return {
          entity,
          timestamp: attachment?.created_at,
          senderId: attachment?.sender_id,
          onClick: (event) => handleEntityClick(entity, event),
        };
      });
  });

  return (
    <>
      <Show when={projectsFlag().enabled && projectAttachments().length > 0}>
        <AttachmentSection label="Projects">
          <div class="flex flex-wrap gap-2 p-4">
            <For each={projectAttachments()}>
              {(id) => <ProjectAttachment id={id} />}
            </For>
          </div>
          <Show when={rows().length === 0 && attachmentsQuery.hasNextPage}>
            <LoadMoreButton
              onLoadMore={() => attachmentsQuery.fetchNextPage()}
              isFetching={() => attachmentsQuery.isFetchingNextPage}
            />
          </Show>
        </AttachmentSection>
      </Show>
      <AttachmentEntityList
        rows={rows()}
        hasNextPage={!!attachmentsQuery.hasNextPage}
        isFetchingNextPage={attachmentsQuery.isFetchingNextPage}
        onLoadMore={() => attachmentsQuery.fetchNextPage()}
      />
    </>
  );
}
