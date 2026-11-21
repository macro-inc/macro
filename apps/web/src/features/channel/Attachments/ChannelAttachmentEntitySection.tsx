import {
  compileToAst,
  defineQueryFilters,
  type Query,
  queryStateFrom,
} from '@app/features/next-soup/filters/filter-store';
import { ProjectAttachment } from '@app/features/projects/project-attachment';
import { useSplitLayout } from '@components/app/split-layout/layout';
import type { EntityData } from '@entity';
import Spinner from '@icon/system/bold/spinner-gap-bold.svg?component-solid';
import {
  type ChannelAttachmentsData,
  flattenAttachments,
  useChannelDocumentAttachmentsQuery,
} from '@queries/channel/channel-attachments';
import { queryReadyGate } from '@queries/gate';
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
  const attachmentsQuery = useChannelDocumentAttachmentsQuery(
    () => props.channelId
  );

  const documentAttachments = createMemo(() =>
    flattenAttachments(
      queryReadyGate(attachmentsQuery)
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
  const hasSoupAttachments = () =>
    documentAttachments().some((item) => item.entity_type !== 'initiative');
  const soupQuery = useSoupAstItemsQuery(
    () => ({
      params: { limit: 500 },
      body: attachmentSoupAst(documentAttachments()),
    }),
    () => ({ enabled: hasSoupAttachments() })
  );
  // A disabled query also reads as pending, so only wait when Soup has work.
  const soupPending = () => hasSoupAttachments() && soupQuery.isPending;

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

  // Soup returns only live entities the viewer can list, of the types the AST
  // names: a trashed or deleted document, one without access, or a pull request
  // is missing from it although its message still shows it. Once Soup answers,
  // such an attachment keeps its row and shows as the message shows it.
  const rows = createMemo<AttachmentEntityListRow[]>(() => {
    const attachments = [...attachmentByEntityId().values()].filter(
      (attachment) => attachment.entity_type !== 'initiative'
    );
    if (attachments.length === 0 || soupQuery.isPending) return [];

    const entityById = new Map(
      (soupQuery.data?.entities ?? []).map((entity) => [entity.id, entity])
    );
    // Previous data kept while a new page of attachments loads has not
    // answered for the new ones yet; they appear once Soup does.
    const answered = !soupQuery.isPlaceholderData;

    return attachments
      .sort((a, b) => b.created_at.localeCompare(a.created_at))
      .flatMap((attachment): AttachmentEntityListRow[] => {
        const entity = entityById.get(attachment.entity_id);
        if (entity) {
          return [
            {
              kind: 'entity',
              entity,
              timestamp: attachment.created_at,
              senderId: attachment.sender_id,
              onClick: (event) => handleEntityClick(entity, event),
            },
          ];
        }

        if (!answered) return [];
        return [{ kind: 'attachment', attachment }];
      });
  });

  return (
    <>
      <Show when={projectAttachments().length > 0}>
        <AttachmentSection label="Projects">
          <div class="flex flex-wrap gap-2 p-4">
            <For each={projectAttachments()}>
              {(id) => <ProjectAttachment id={id} />}
            </For>
          </div>
          <Show
            when={
              !soupPending() &&
              rows().length === 0 &&
              attachmentsQuery.hasNextPage
            }
          >
            <LoadMoreButton
              onLoadMore={() => attachmentsQuery.fetchNextPage()}
              isFetching={() => attachmentsQuery.isFetchingNextPage}
            />
          </Show>
        </AttachmentSection>
      </Show>
      <Show
        when={!attachmentsQuery.isPending && !soupPending()}
        fallback={
          <AttachmentSection label="Documents">
            <div class="grid place-items-center py-3 text-ink-muted">
              <Spinner
                aria-hidden={false}
                aria-label="Loading documents"
                class="size-5 animate-spin"
              />
            </div>
          </AttachmentSection>
        }
      >
        <AttachmentEntityList
          rows={rows()}
          hasNextPage={!!attachmentsQuery.hasNextPage}
          isFetchingNextPage={attachmentsQuery.isFetchingNextPage}
          onLoadMore={() => attachmentsQuery.fetchNextPage()}
        />
      </Show>
    </>
  );
}
