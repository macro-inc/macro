import { createMemo } from 'solid-js';
import {
  flattenAttachments,
  useChannelAttachmentsQuery,
  type ChannelAttachmentsData,
} from '@queries/channel/channel-attachments';
import { mapChannelAttachmentsToMediaItems } from '@channel/Media/media-items';
import { MediaGallery } from './MediaGallery';

export function ChannelAttachmentMediaSection(props: { channelId: string }) {
  const attachmentsQuery = useChannelAttachmentsQuery(() => props.channelId);

  const items = createMemo(() =>
    mapChannelAttachmentsToMediaItems(
      flattenAttachments(
        attachmentsQuery.data as ChannelAttachmentsData | undefined
      )
    )
  );

  return (
    <MediaGallery
      items={items()}
      hasNextPage={!!attachmentsQuery.hasNextPage}
      isFetchingNextPage={attachmentsQuery.isFetchingNextPage}
      onLoadMore={() => attachmentsQuery.fetchNextPage()}
    />
  );
}
