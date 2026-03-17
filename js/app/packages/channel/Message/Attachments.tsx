import { ItemPreview } from '@core/component/ItemPreview';
import {
  isStaticAttachmentType,
  STATIC_IMAGE,
  STATIC_VIDEO,
} from '@core/store/cacheChannelInput';
import { stringToItemType } from '@service-storage/client';
import type { ApiMessageAttachment } from '@service-storage/generated/schemas/apiMessageAttachment';
import { cn } from '@ui/utils/classname';
import { createMemo, For, Match, Show, Switch } from 'solid-js';
import { useMessage } from './context';
import { MediaPreview } from './MediaPreview';

type AttachmentsProps = {
  class?: string;
};

type MessageAttachmentBuckets = {
  imageAttachments: ApiMessageAttachment[];
  videoAttachments: ApiMessageAttachment[];
  documentAttachments: ApiMessageAttachment[];
};

export function partitionMessageAttachments(
  attachments: ApiMessageAttachment[]
): MessageAttachmentBuckets {
  const imageAttachments: ApiMessageAttachment[] = [];
  const videoAttachments: ApiMessageAttachment[] = [];
  const documentAttachments: ApiMessageAttachment[] = [];

  for (const attachment of attachments) {
    if (attachment.entity_type === STATIC_IMAGE) {
      imageAttachments.push(attachment);
      continue;
    }

    if (attachment.entity_type === STATIC_VIDEO) {
      videoAttachments.push(attachment);
      continue;
    }

    if (!isStaticAttachmentType(attachment.entity_type)) {
      documentAttachments.push(attachment);
    }
  }

  return {
    imageAttachments,
    videoAttachments,
    documentAttachments,
  };
}

export function Attachments(props: AttachmentsProps) {
  const message = useMessage();
  const buckets = createMemo(() =>
    partitionMessageAttachments(message().attachments ?? [])
  );
  const imagePreviewData = createMemo(() =>
    buckets().imageAttachments.map((attachment) => ({
      id: attachment.entity_id,
    }))
  );
  const imageAttachmentIds = createMemo(() =>
    buckets().imageAttachments.map((attachment) => attachment.id)
  );
  const hasAttachments = createMemo(
    () =>
      buckets().imageAttachments.length > 0 ||
      buckets().videoAttachments.length > 0 ||
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
        <Show when={buckets().videoAttachments.length > 0}>
          <For each={buckets().videoAttachments}>
            {(attachment) => (
              <MediaPreview kind="video" id={attachment.entity_id} />
            )}
          </For>
        </Show>

        <Show when={buckets().imageAttachments.length > 0}>
          <div class="flex not-first:mt-2">
            <Switch>
              <Match when={buckets().imageAttachments.length === 1}>
                <MediaPreview
                  kind="single-image"
                  image={imagePreviewData()[0]!}
                />
              </Match>
              <Match when={buckets().imageAttachments.length > 1}>
                <MediaPreview
                  kind="image-gallery"
                  images={imagePreviewData()}
                  attachmentIds={imageAttachmentIds()}
                />
              </Match>
            </Switch>
          </div>
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
