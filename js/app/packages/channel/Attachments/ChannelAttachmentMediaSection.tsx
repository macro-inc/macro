import { createMemo } from 'solid-js';
import {
  flattenAttachments,
  useChannelAttachmentsQuery,
  type ChannelAttachmentsData,
} from '@queries/channel/channel-attachments';
import {
  type MediaItem,
  mapChannelAttachmentsToMediaItems,
} from '@channel/Media/media-items';
import { MediaGallery } from './MediaGallery';

export function ChannelAttachmentMediaSection(props: { channelId: string }) {
  const attachmentsQuery = useChannelAttachmentsQuery(() => props.channelId);

  const items = createMemo<MediaItem[]>((previous = []) =>
    mapChannelAttachmentsToMediaItems(
      flattenAttachments(
        attachmentsQuery.data as ChannelAttachmentsData | undefined
      ),
      previous
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
