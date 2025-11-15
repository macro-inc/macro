import { useSplitLayout } from '@app/component/split-layout/layout';
import { EntityIcon } from '@core/component/EntityIcon';
import { ImagePreview } from '@core/component/ImagePreview';
import { TextButton } from '@core/component/TextButton';
import {
  blockNameToDefaultFile,
  fileTypeToBlockName,
} from '@core/constant/allBlocks';
import { staticFileIdEndpoint } from '@core/constant/servers';
import {
  type InputAttachment,
  isStaticAttachmentType,
  STATIC_IMAGE,
  STATIC_VIDEO,
} from '@core/store/cacheChannelInput';
import { matches } from '@core/util/match';
import { truncateString } from '@core/util/string';
import XIcon from '@icon/regular/x.svg';
import Spinner from '@phosphor-icons/core/bold/spinner-gap-bold.svg?component-solid';
import { createSignal, Match, Show, Switch } from 'solid-js';

type AttachmentProps = {
  attachment: InputAttachment;
  remove?: (attachment: InputAttachment) => void;
  onClick?: (attachment: InputAttachment) => void;
};

export function Attachment(props: AttachmentProps) {
  const { insertSplit } = useSplitLayout();
  const [hover, setHover] = createSignal(false);

  const attachmentName = () => {
    const baseName =
      props.attachment.name ??
      blockNameToDefaultFile(props.attachment.blockName as any);

    return baseName;
  };

  return (
    <div
      class="relative flex flex-row items-center"
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
    >
      <Show when={hover() && props.remove}>
        <XIcon
          class="w-6 h-6 text-ink absolute -top-2 -right-2 rounded-full bg-menu  p-1 border border-edge-muted z-[10]"
          onClick={() => props.remove?.(props.attachment)}
        />
      </Show>
      <Switch>
        <Match
          when={
            props.attachment.pending &&
            props.attachment.blockName === STATIC_VIDEO
          }
        >
          <div class="flex flex-col items-center justify-center gap-2 w-[60px] h-[60px] border border-edge-muted rounded-md bg-menu">
            <Spinner class="w-4 h-4 animate-spin" />
          </div>
        </Match>
        <Match
          when={
            props.attachment.pending &&
            props.attachment.blockName === STATIC_IMAGE
          }
        >
          <div class="flex flex-col items-center justify-center gap-2 w-[60px] h-[60px] border border-edge-muted rounded-md bg-menu">
            <Spinner class="w-4 h-4 animate-spin" />
          </div>
        </Match>
        <Match when={props.attachment.blockName === STATIC_IMAGE}>
          <ImagePreview
            id={props.attachment.id}
            variant="small"
            isCurrentUser={true}
          />
        </Match>
        <Match when={props.attachment.blockName === STATIC_VIDEO}>
          <video
            src={staticFileIdEndpoint(props.attachment.id)}
            class="size-15"
          />
        </Match>
        <Match
          when={matches(
            props.attachment.blockName,
            (bn) => !isStaticAttachmentType(bn)
          )}
        >
          {(blockName) => (
            <TextButton
              theme="base"
              disabled={props.attachment.pending}
              icon={() =>
                props.attachment.pending ? (
                  <Spinner class="w-4 h-4 animate-spin" />
                ) : (
                  <EntityIcon targetType={blockName()} size="xs" />
                )
              }
              text={truncateString(attachmentName(), 30)}
              onClick={() => {
                if (props.attachment.pending) return;
                insertSplit({
                  type: fileTypeToBlockName(blockName()),
                  id: props.attachment.id,
                });
              }}
            />
          )}
        </Match>
      </Switch>
    </div>
  );
}
