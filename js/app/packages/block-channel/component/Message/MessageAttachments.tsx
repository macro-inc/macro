import { ItemPreview } from '@core/component/ItemPreview';
import { VideoPreview } from '@core/component/VideoPreview';
import type { Attachment } from '@service-comms/generated/models/attachment';
import { stringToItemType } from '@service-storage/client';
import { type Accessor, For, Show } from 'solid-js';
import { DynamicImageList } from './DynamicImageList';

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
    <div class="allow-css-brackets">
      {/* Video attachments */}
      <Show when={props.videoAttachments()?.length > 0 && !props.isDeleted()}>
        <For each={props.videoAttachments()}>
          {(item) => <VideoPreview id={item.entity_id} variant="dynamic" />}
        </For>
      </Show>
      {/* Image attachments */}
      <Show when={props.imageAttachments()?.length > 0 && !props.isDeleted()}>
        <div class="flex not-first:mt-2">
          <DynamicImageList
            ids={props.imageAttachments()?.map((a) => a.entity_id)}
            attachmentIds={props.imageAttachments()?.map((a) => a.id)}
            isCurrentUser={props.isCurrentUser()}
            channelId={props.channelId}
            messageId={props.messageId}
            content={props.content}
          />
        </div>
      </Show>
      {/* Document attachments */}
      <Show
        when={props.documentAttachments()?.length > 0 && !props.isDeleted()}
      >
        <div class={`flex flex-row mt-2 gap-2 flex-wrap max-w-full`}>
          <For each={props.documentAttachments()}>
            {(attachment) => (
              <ItemPreview
                itemType={stringToItemType(attachment.entity_type)}
                itemId={attachment.entity_id}
              />
            )}
          </For>
        </div>
      </Show>
    </div>
  );
}
