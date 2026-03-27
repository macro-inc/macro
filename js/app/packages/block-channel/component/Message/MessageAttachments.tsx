import { ItemPreview } from '@core/component/ItemPreview';
import { VideoPreview } from '@core/component/VideoPreview';
import type { Attachment } from '@queries/channel/types';
import { stringToItemType } from '@service-storage/client';
import { type Accessor, For, Show } from 'solid-js';
import { DynamicImageList } from './DynamicImageList';
import { cn } from '@ui/utils/classname';

type MessageAttachmentsProps = {
  videoAttachments: Accessor<Attachment[]>;
  imageAttachments: Accessor<Attachment[]>;
  documentAttachments: Accessor<Attachment[]>;
  isDeleted: Accessor<boolean>;
  isCurrentUser: Accessor<boolean>;
  channelId: string;
  messageId: string;
  content: string;
};

export function MessageAttachments(props: MessageAttachmentsProps) {
  return (
    <div
      class={cn(
        'ph-no-capture allow-css-brackets mb-2',
        (!(
          props.documentAttachments()?.length > 0 ||
          props.imageAttachments()?.length > 0 ||
          props.videoAttachments()?.length > 0
        ) ||
          props.isDeleted()) &&
          'hidden'
      )}
    >
      {/* Video attachments */}
      <Show when={props.videoAttachments()?.length > 0}>
        <For each={props.videoAttachments()}>
          {(item) => (
            <VideoPreview
              id={item.entity_id}
              variant="dynamic"
              width={item.width}
              height={item.height}
            />
          )}
        </For>
      </Show>
      {/* Image attachments */}
      <Show when={props.imageAttachments()?.length > 0}>
        <div class="flex not-first:mt-2">
          <DynamicImageList
            images={props.imageAttachments()?.map((a) => ({
              id: a.entity_id,
              width: a.width ?? undefined,
              height: a.height ?? undefined,
            }))}
            attachmentIds={props.imageAttachments()?.map((a) => a.id)}
            isCurrentUser={props.isCurrentUser()}
            channelId={props.channelId}
            messageId={props.messageId}
            content={props.content}
          />
        </div>
      </Show>
      {/* Document attachments */}
      <Show when={props.documentAttachments()?.length > 0}>
        <div class={`flex flex-row mt-2 gap-2 flex-wrap max-w-full`}>
          <For each={props.documentAttachments()}>
            {(attachment) => (
              <ItemPreview
                type={stringToItemType(attachment.entity_type)}
                id={attachment.entity_id}
              />
            )}
          </For>
        </div>
      </Show>
    </div>
  );
}
