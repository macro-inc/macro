import { ImageGalleryPreview } from '@core/component/ImageGalleryPreview';
import { ImagePreview } from '@core/component/ImagePreview';
import { commsServiceClient } from '@service-comms/client';
import { Match, Switch } from 'solid-js';

type DynamicImageListProps = {
  ids: string[];
  attachmentIds: string[];
  isCurrentUser: boolean;
  channelId?: string;
  messageId?: string;
  content?: string;
  isContext?: boolean;
};

// TODO: wip
export function DynamicImageList(props: DynamicImageListProps) {
  const handleDelete = async (attachmentId: string) => {
    if (!props.isCurrentUser || !props.channelId || !props.messageId) return;
    await commsServiceClient.patchMessage({
      channel_id: props.channelId,
      message_id: props.messageId,
      content: props.content,
      attachment_ids_to_delete: [attachmentId],
    });
  };

  return (
    <Switch>
      <Match when={props.ids.length === 1}>
        <div class="max-w-[400px] w-fit mt-0.5">
          <ImagePreview
            id={props.ids[0]}
            variant="dynamic"
            onDelete={
              props.isCurrentUser
                ? () => handleDelete(props.attachmentIds[0])
                : undefined
            }
            isContext={props.isContext}
          />
        </div>
      </Match>

      <Match when={props.ids.length > 1}>
        <div class={`flex flex-wrap gap-2 mt-0.5`}>
          <ImageGalleryPreview
            ids={props.ids}
            variant="dynamic"
            attachmentIds={props.attachmentIds}
            onDelete={props.isCurrentUser ? handleDelete : undefined}
            isContext={props.isContext}
          />
        </div>
      </Match>
    </Switch>
  );
}
