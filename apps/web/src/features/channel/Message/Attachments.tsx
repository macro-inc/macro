import { ProjectAttachment } from '@app/features/projects/project-attachment';
import {
  type MediaItem,
  mapMediaItems,
  partitionAttachments,
} from '@channel/Media/media-items';
import { ItemPreview } from '@core/component/ItemPreview';
import { stringToItemType } from '@service-storage/client';
import { cn } from '@ui';
import { createMemo, For, Show } from 'solid-js';
import { splitMessageContent } from './agent-session-link';
import { useMessage } from './context';
import { MediaPreview } from './MediaPreview';
import { liftChannelMarkdownImages } from './markdown-images';

type AttachmentsProps = {
  class?: string;
};

export function Attachments(props: AttachmentsProps) {
  const message = useMessage();
  const buckets = createMemo(() => {
    const attachments = [...(message().attachments ?? [])];
    const existing = new Set(
      attachments.map((attachment) => attachment.entity_id)
    );
    for (const image of liftChannelMarkdownImages(
      splitMessageContent(message()).body
    ).images) {
      if (existing.has(image.entity_id)) continue;
      existing.add(image.entity_id);
      attachments.push({
        id: image.entity_id,
        entity_id: image.entity_id,
        entity_type: image.entity_type,
        width: image.width,
        height: image.height,
        created_at: message().created_at,
      });
    }
    return partitionAttachments(attachments);
  });
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
      <div class={cn('mb-2', props.class)} data-message-attachments>
        <Show when={mediaItems().length > 0}>
          <MediaPreview items={mediaItems()} />
        </Show>

        <Show when={buckets().documentAttachments.length > 0}>
          <div class="flex flex-row mt-2 gap-2 flex-wrap max-w-full">
            <For each={buckets().documentAttachments}>
              {(attachment) => (
                <Show
                  when={attachment.entity_type === 'initiative'}
                  fallback={
                    <ItemPreview
                      id={attachment.entity_id}
                      type={stringToItemType(attachment.entity_type)}
                    />
                  }
                >
                  <ProjectAttachment id={attachment.entity_id} />
                </Show>
              )}
            </For>
          </div>
        </Show>
      </div>
    </Show>
  );
}
