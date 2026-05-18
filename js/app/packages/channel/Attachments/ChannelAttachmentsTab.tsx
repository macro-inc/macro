import { Suspense } from 'solid-js';
import { ChannelAttachmentEntitySection } from './ChannelAttachmentEntitySection';
import { ChannelAttachmentMediaSection } from './ChannelAttachmentMediaSection';

export function ChannelAttachmentsTab(props: { channelId: string }) {
  return (
    <div class="relative flex-1 min-h-0 h-full overflow-hidden flex justify-center p-2">
      <div
        class="macro-message-width size-full"
        style={{
          'grid-template-rows': 'minmax(0, 1fr) minmax(0, 1fr)',
          'grid-template-columns': '1fr',
          overflow: 'hidden',
          display: 'grid',
          gap: '8px',
        }}
      >
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
