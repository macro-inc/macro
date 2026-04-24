import { createMemo } from 'solid-js';
import {
  flattenAttachments,
  useChannelMediaAttachmentsQuery,
  type ChannelAttachmentsData,
} from '@queries/channel/channel-attachments';
import { type MediaItem, mapMediaItems } from '@channel/Media/media-items';
import { MediaGallery } from './MediaGallery';

export function ChannelAttachmentMediaSection(props: { channelId: string }) {
  const attachmentsQuery = useChannelMediaAttachmentsQuery(
    () => props.channelId
  );

  const items = createMemo<MediaItem[]>((previous = []) =>
    mapMediaItems(
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
