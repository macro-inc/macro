import { ImageGalleryPreview } from '@core/component/ImageGalleryPreview';
import { ImagePreview } from '@core/component/ImagePreview';
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
  return (
    <Switch>
      <Match when={props.ids.length === 1}>
        <div class="max-w-[400px] w-fit mt-0.5">
          <ImagePreview
            id={props.ids[0]}
            variant="dynamic"
            isCurrentUser={props.isCurrentUser}
            channelId={props.isCurrentUser ? props.channelId : undefined}
            messageId={props.isCurrentUser ? props.messageId : undefined}
            attachmentId={
              props.isCurrentUser ? props.attachmentIds[0] : undefined
            }
            content={props.content}
            isContext={props.isContext}
          />
        </div>
      </Match>

      <Match when={props.ids.length > 1}>
        <div class={`flex flex-wrap gap-2 mt-0.5`}>
          <ImageGalleryPreview
            ids={props.ids}
            variant="dynamic"
            isCurrentUser={props.isCurrentUser}
            channelId={props.isCurrentUser ? props.channelId : undefined}
            messageId={props.isCurrentUser ? props.messageId : undefined}
            attachmentIds={props.isCurrentUser ? props.attachmentIds : []}
            content={props.content}
            isContext={props.isContext}
          />
        </div>
      </Match>
    </Switch>
  );
}
