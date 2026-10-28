import { Suspense } from 'solid-js';
import { ChannelAttachmentEntitySection } from './ChannelAttachmentEntitySection';
import { ChannelAttachmentMediaSection } from './ChannelAttachmentMediaSection';

export function ChannelAttachmentsTab(props: { channelId: string }) {
  return (
    <div class="relative flex-1 min-h-0 h-full overflow-hidden flex justify-center p-2">
      <div class="macro-message-width size-full flex flex-col gap-2 overflow-hidden">
        <Suspense>
          <ChannelAttachmentMediaSection channelId={props.channelId} />
        </Suspense>
        <Suspense>
          <ChannelAttachmentEntitySection channelId={props.channelId} />
        </Suspense>
      </div>
    </div>
  );
}
