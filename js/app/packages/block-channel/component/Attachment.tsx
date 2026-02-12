import { ImagePreview } from '@core/component/ImagePreview';
import { ItemPreview } from '@core/component/ItemPreview';
import { VideoPreview } from '@core/component/VideoPreview';
import {
  type InputAttachment,
  isStaticAttachmentType,
  STATIC_IMAGE,
  STATIC_VIDEO,
} from '@core/store/cacheChannelInput';
import { matches } from '@core/util/match';
import Close from '@phosphor-icons/core/regular/x.svg?component-solid';
import Spinner from '@phosphor-icons/core/bold/spinner-gap-bold.svg?component-solid';
import { blockNameToItemType } from '@service-storage/client';
import { createSignal, Match, Show, Switch } from 'solid-js';

type AttachmentProps = {
  attachment: InputAttachment;
  remove?: (attachment: InputAttachment) => void;
  onClick?: (attachment: InputAttachment) => void;
};

export function Attachment(props: AttachmentProps) {
  const [hover, setHover] = createSignal(false);

  const isStaticMedia = () =>
    props.attachment.blockName === STATIC_IMAGE ||
    props.attachment.blockName === STATIC_VIDEO;

  return (
    <Switch>
      <Match when={isStaticMedia()}>
        <div
          class="relative"
          onMouseEnter={() => setHover(true)}
          onMouseLeave={() => setHover(false)}
        >
          <Show when={hover() && props.remove}>
            <Close
              width={24}
              height={24}
              class="text-ink absolute -top-2 -right-2 rounded-full bg-menu p-1 border border-edge-muted z-[10] cursor-pointer"
              onClick={() => props.remove?.(props.attachment)}
            />
          </Show>
          <Show when={props.attachment.pending}>
            <div class="flex flex-col items-center justify-center gap-2 w-[60px] h-[60px] border border-edge-muted rounded-md bg-menu">
              <Spinner class="w-4 h-4 animate-spin" />
            </div>
          </Show>
          <Show
            when={
              !props.attachment.pending &&
              props.attachment.blockName === STATIC_IMAGE
            }
          >
            <ImagePreview
              image={{
                id: props.attachment.id,
              }}
              variant="small"
            />
          </Show>
          <Show
            when={
              !props.attachment.pending &&
              props.attachment.blockName === STATIC_VIDEO
            }
          >
            <VideoPreview id={props.attachment.id} variant="small" />
          </Show>
        </div>
      </Match>
      <Match
        when={matches(
          props.attachment.blockName,
          (bn) => !isStaticAttachmentType(bn)
        )}
      >
        {(blockName) => (
          <div class="flex items-center px-1 space-x-1 hover:bg-hover hover-transition-bg cursor-default text-sm border border-edge-muted rounded-xs">
            <Show when={props.attachment.pending}>
              <Spinner class="w-4 h-4 animate-spin" />
            </Show>
            <Show when={!props.attachment.pending}>
              <ItemPreview
                id={props.attachment.id}
                type={blockNameToItemType(blockName())}
                class="flex items-center gap-1 text-sm ring-0"
                textClass="truncate"
                iconSize="xs"
                disableHoverCard
              />
            </Show>
            <Show when={props.remove}>
              <div
                class="hover:bg-hover hover-transition-bg rounded-md p-1 items-center flex"
                onClick={(e) => {
                  e.stopPropagation();
                  props.remove?.(props.attachment);
                }}
              >
                <Close class="text-ink-muted group-hover:text-failure size-3" />
              </div>
            </Show>
          </div>
        )}
      </Match>
    </Switch>
  );
}
