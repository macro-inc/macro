import { ItemPreview } from '@core/component/ItemPreview';
import {
  type InputAttachment,
  isStaticAttachmentType,
} from '@core/store/cacheChannelInput';
import { matches } from '@core/util/match';
import Close from '@phosphor-icons/core/regular/x.svg?component-solid';
import Spinner from '@phosphor-icons/core/bold/spinner-gap-bold.svg?component-solid';
import { blockNameToItemType } from '@service-storage/client';
import { Match, Show, Switch } from 'solid-js';

type AttachmentProps = {
  attachment: InputAttachment;
  remove?: (attachment: InputAttachment) => void;
  onClick?: (attachment: InputAttachment) => void;
};

export function Attachment(props: AttachmentProps) {
  return (
    <Switch>
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
                <Close
                  width={12}
                  height={12}
                  class="text-ink-muted group-hover:text-failure"
                />
              </div>
            </Show>
          </div>
        )}
      </Match>
    </Switch>
  );
}
