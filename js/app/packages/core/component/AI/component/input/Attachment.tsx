import type { Attachment, AttachmentPreview } from '@core/component/AI/types';
import {
  isDssImage,
  isImageAttachment,
} from '@core/component/AI/util/attachment';
import { EntityIcon } from '@core/component/EntityIcon';
import { ImagePreview } from '@core/component/ImagePreview';
import { ItemPreview } from '@core/component/ItemPreview';
import { toast } from '@core/component/Toast/Toast';
import XIcon from '@icon/regular/x.svg';
import Spinner from '@phosphor-icons/core/bold/spinner-gap-bold.svg?component-solid';
import Close from '@phosphor-icons/core/regular/x.svg?component-solid';
import type { ItemType } from '@service-storage/client';
import type { Accessor } from 'solid-js';
import { createSignal, For, Match, Show, Suspense, Switch } from 'solid-js';

type AttachmentListProps = {
  removeAttachment: (id: string) => void;
  attached: Accessor<Attachment[]>;
  uploading: Accessor<AttachmentPreview[]>;
};

export function AttachmentList(props: AttachmentListProps) {
  return (
    <div class="flex flex-row w-full space-x-2 items-end flex-wrap overflow-x-hidden pb-1">
      <For each={props.attached()}>
        {(attachment) => (
          <Suspense>
            <ChatAttachment
              attachment={attachment}
              onRemove={() => props.removeAttachment(attachment.entity_id)}
            />
          </Suspense>
        )}
      </For>
      <For each={props.uploading()}>
        {(uploading) => <UploadingAttachment {...uploading} />}
      </For>
    </div>
  );
}

function UploadingAttachment(props: AttachmentPreview) {
  return (
    <Switch>
      <Match when={isImageAttachment(props)}>
        <div class="flex flex-col items-center justify-center gap-2 size-15 border border-edge rounded-md bg-menu">
          <Spinner class="size-4 animate-spin" />
        </div>
      </Match>
      <Match when={isDssImage(props) && props.metadata}>
        {(metadata) => (
          <div class="flex gap-1 items-center text-sm cursor-default">
            <EntityIcon targetType={metadata().document_type} />
            <div>{metadata().document_name}</div>
          </div>
        )}
      </Match>
    </Switch>
  );
}

function ImageAttachment(props: {
  attachment: Attachment;
  onRemove: () => void;
}) {
  const [hover, setHover] = createSignal(false);

  return (
    <div
      class="relative flex flex-row items-center"
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
    >
      <Show when={hover()}>
        <XIcon
          class="size-6 text-ink absolute -top-2 -right-2 rounded-full bg-menu p-1 border border-edge z-10"
          onClick={() => props.onRemove()}
        />
      </Show>
      <ImagePreview
        image={{ id: props.attachment.entity_id }}
        variant="small"
        isDss={false}
        onError={(e) => {
          console.error('Failed to load image', e);
          toast.failure('Failed to load image');
          props.onRemove();
        }}
      />
    </div>
  );
}

function ChatAttachment(props: {
  attachment: Attachment;
  onRemove: () => void;
}) {
  return (
    <Switch>
      <Match when={props.attachment.entity_type === 'static_file'}>
        <ImageAttachment
          attachment={props.attachment}
          onRemove={props.onRemove}
        />
      </Match>
      <Match
        when={['document', 'channel', 'project', 'email_thread'].includes(
          props.attachment.entity_type
        )}
      >
        <div class="flex items-center px-1 space-x-1 hover:bg-hover hover-transition-bg cursor-default text-sm border border-edge-muted rounded-xs">
          <ItemPreview
            id={props.attachment.entity_id}
            type={
              (props.attachment.entity_type === 'email_thread'
                ? 'email'
                : props.attachment.entity_type) as ItemType
            }
            class="flex items-center gap-1 text-sm ring-0"
            textClass="truncate"
            iconSize="xs"
            disableHoverCard
          />
          <div
            class="hover:bg-hover hover-transition-bg rounded-md p-1 items-center flex"
            onClick={(e) => {
              e.stopPropagation();
              props.onRemove?.();
            }}
          >
            <Close
              width={12}
              height={12}
              class="text-ink-muted group-hover:text-failure"
            />
          </div>
        </div>
      </Match>
    </Switch>
  );
}
