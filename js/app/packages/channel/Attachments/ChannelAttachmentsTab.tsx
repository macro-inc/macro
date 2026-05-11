import { Suspense } from 'solid-js';
import { ChannelAttachmentEntitySection } from './ChannelAttachmentEntitySection';
import { ChannelAttachmentMediaSection } from './ChannelAttachmentMediaSection';
import {
  AttachmentEntityListSkeleton,
  MediaGallerySkeleton,
} from './Skeletons';

export function ChannelAttachmentsTab(props: { channelId: string }) {
  return (
    <div class="relative flex-1 min-h-0 overflow-y-auto">
      <div class="macro-message-width macro-message-padding mx-auto flex size-full min-h-0 flex-col gap-6 py-4">
        <Suspense fallback={<MediaGallerySkeleton />}>
          <ChannelAttachmentMediaSection channelId={props.channelId} />
        </Suspense>
        <Suspense fallback={<AttachmentEntityListSkeleton />}>
          <ChannelAttachmentEntitySection channelId={props.channelId} />
        </Suspense>
      </div>
    </div>
  );
}
