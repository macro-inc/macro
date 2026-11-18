import {
  type MediaItem,
  mapMediaItems,
  partitionAttachments,
} from '@channel/Media/media-items';
import { getDocumentMentions } from '@core/util/documentMentions';
import { cn } from '@ui';
import { createMemo, For, Show } from 'solid-js';
import { AttachmentChip } from './AttachmentChip';
import { splitMessageContent } from './agent-session-link';
import { useMessage } from './context';
import { DocumentImagePreview } from './DocumentImagePreview';
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
  // A document the text also mentions already previews under the text
  // (MentionedImages); previewing the attachment too would show it twice.
  const documentIds = createMemo(() => {
    const mentioned = getDocumentMentions(
      splitMessageContent(message()).body
    ).map((mention) => mention.documentId);

    return buckets()
      .documentAttachments.filter(
        (attachment) =>
          attachment.entity_type === 'document' &&
          !mentioned.includes(attachment.entity_id)
      )
      .map((attachment) => attachment.entity_id);
  });
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

        <For each={documentIds()}>
          {(documentId) => <DocumentImagePreview documentId={documentId} />}
        </For>

        <Show when={buckets().documentAttachments.length > 0}>
          <div class="flex flex-row mt-2 gap-2 flex-wrap max-w-full">
            <For each={buckets().documentAttachments}>
              {(attachment) => <AttachmentChip attachment={attachment} />}
            </For>
          </div>
        </Show>
      </div>
    </Show>
  );
}
