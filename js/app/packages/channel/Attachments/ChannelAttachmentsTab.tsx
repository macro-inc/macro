import { createMemo, For, Suspense } from 'solid-js';
import {
  flattenAttachments,
  useChannelAttachmentsQuery,
  type ChannelAttachmentsData,
} from '@queries/channel/channel-attachments';
import { SectionHeader} from './SectionHeader';
import { MediaGallery } from './MediaGallery';
import { ThumbnailSkeleton, DocumentRowSkeleton } from './Skeletons';
import { AttachmentEntityList } from './AttachmentEntityList';

const MEDIA_SKELETON_COUNT = 6;
const DOCUMENT_SKELETON_COUNT = 6;

function AttachmentsTabSkeleton() {
  return (
    <div class="relative flex-1 min-h-0 overflow-y-auto">
      <div class="macro-message-width macro-message-padding mx-auto w-full py-4 flex flex-col gap-6">
        <div class="flex flex-col">
          <SectionHeader label="Photos and videos" />
          <div class="flex flex-row flex-wrap gap-1.5 pt-3">
            <For each={Array.from({ length: MEDIA_SKELETON_COUNT })}>
              {() => <ThumbnailSkeleton />}
            </For>
          </div>
        </div>
        <div class="flex flex-col">
          <SectionHeader label="Documents" />
          <For each={Array.from({ length: DOCUMENT_SKELETON_COUNT })}>
            {() => <DocumentRowSkeleton />}
          </For>
        </div>
      </div>
    </div>
  );
}

function AttachmentsTabContent(props: { channelId: string }) {
  const attachmentsQuery = useChannelAttachmentsQuery(() => props.channelId);

  const allAttachments = createMemo(() =>
    flattenAttachments(
      attachmentsQuery.data as ChannelAttachmentsData | undefined
    )
  );

  const hasNextPage = () => !!attachmentsQuery.hasNextPage;
  const isFetchingNextPage = () => attachmentsQuery.isFetchingNextPage;
  const loadMore = () => attachmentsQuery.fetchNextPage();

  return (
    <div class="relative flex-1 min-h-0 overflow-y-auto">
      <div class="macro-message-width macro-message-padding mx-auto w-full py-4 flex flex-col gap-6">
        <MediaGallery
          attachments={allAttachments}
          hasNextPage={hasNextPage}
          isFetchingNextPage={isFetchingNextPage}
          onLoadMore={loadMore}
        />
        <AttachmentEntityList
          attachments={allAttachments}
          hasNextPage={hasNextPage}
          isFetchingNextPage={isFetchingNextPage}
          onLoadMore={loadMore}
        />
      </div>
    </div>
  );
}

export function ChannelAttachmentsTab(props: { channelId: string }) {
  return (
    <Suspense fallback={<AttachmentsTabSkeleton />}>
      <AttachmentsTabContent channelId={props.channelId} />
    </Suspense>
  );
}
