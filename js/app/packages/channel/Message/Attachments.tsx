import { ItemPreview } from '@core/component/ItemPreview';
import { stringToItemType } from '@service-storage/client';
import { cn } from '@ui/utils/classname';
import { createMemo, For, Show } from 'solid-js';
import {
  type MediaItem,
  mapMediaItems,
  partitionAttachments,
} from '@channel/Media/media-items';
import { useMessage } from './context';
import { MediaPreview } from './MediaPreview';

type AttachmentsProps = {
  class?: string;
};

export function Attachments(props: AttachmentsProps) {
  const message = useMessage();
  const buckets = createMemo(() =>
    partitionAttachments(message().attachments ?? [])
  );
  const mediaItems = createMemo<MediaItem[]>((previous = []) =>
    mapMediaItems(buckets().mediaAttachments, previous)
  );
  const hasAttachments = createMemo(
    () =>
      buckets().mediaAttachments.length > 0 ||
      buckets().documentAttachments.length > 0
  );
  const shouldRender = createMemo(
    () => hasAttachments() && !message().deleted_at
  );

  return (
    <Show when={shouldRender()}>
      <div
        class={cn('allow-css-brackets mb-2', props.class)}
        data-message-attachments
      >
        <Show when={mediaItems().length > 0}>
          <MediaPreview items={mediaItems()} />
        </Show>

        <Show when={buckets().documentAttachments.length > 0}>
          <div class="flex flex-row mt-2 gap-2 flex-wrap max-w-full">
            <For each={buckets().documentAttachments}>
              {(attachment) => (
                <ItemPreview
                  id={attachment.entity_id}
                  type={stringToItemType(attachment.entity_type)}
                />
              )}
            </For>
          </div>
        </Show>
      </div>
    </Show>
  );
}
