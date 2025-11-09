import { useSplitLayout } from '@app/component/split-layout/layout';
import type { Attachment, AttachmentPreview } from '@core/component/AI/types';
import {
  isDssImage,
  isImageAttachment,
} from '@core/component/AI/util/attachment';
import { EntityIcon } from '@core/component/EntityIcon';
import { ImagePreview } from '@core/component/ImagePreview';
import { toast } from '@core/component/Toast/Toast';
import { fileTypeToBlockName } from '@core/constant/allBlocks';
import BuildingIcon from '@icon/duotone/building-office-duotone.svg';
import GlobeIcon from '@icon/duotone/globe-duotone.svg';
import ChannelIcon from '@icon/duotone/hash-duotone.svg';
import User from '@icon/duotone/user-duotone.svg';
import ThreeUsersIcon from '@icon/duotone/users-three-duotone.svg';
import XIcon from '@icon/regular/x.svg';
import Spinner from '@phosphor-icons/core/bold/spinner-gap-bold.svg?component-solid';
import Envelope from '@phosphor-icons/core/regular/envelope.svg';
import Close from '@phosphor-icons/core/regular/x.svg?component-solid';
import type { ChannelType } from '@service-cognition/generated/schemas';
import type { Accessor } from 'solid-js';
import { createMemo, createSignal, For, Match, Show, Switch } from 'solid-js';
import { Dynamic } from 'solid-js/web';

type AttachmentListProps = {
  removeAttachment: (id: string) => void;
  attached: Accessor<Attachment[]>;
  uploading: Accessor<AttachmentPreview[]>;
};

export function AttachmentList(props: AttachmentListProps) {
  return (
    <div class="flex flex-row w-full space-x-2 items-center flex-wrap overflow-x-hidden">
      <For each={props.attached()}>
        {(attachment) => (
          <ChatAttachment
            attachment={attachment}
            onRemove={() => props.removeAttachment(attachment.attachmentId)}
          />
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
        <div class="flex flex-col items-center justify-center gap-2 w-[60px] h-[60px] border border-edge rounded-md bg-menu">
          <Spinner class="w-4 h-4 animate-spin" />
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
          class="w-6 h-6 text-ink absolute -top-2 -right-2 rounded-full bg-menu  p-1 border border-edge z-[10]"
          onClick={() => props.onRemove()}
        />
      </Show>
      <ImagePreview
        id={props.attachment.attachmentId}
        variant="small"
        isCurrentUser={true}
        isDss={isDssImage(props.attachment)}
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
  const { replaceOrInsertSplit } = useSplitLayout();

  const name = createMemo(() => {
    const attachment = props.attachment;
    if (!attachment.metadata) return '';
    return attachment.metadata.type === 'document'
      ? attachment.metadata.document_name
      : attachment.metadata.type === 'image'
        ? attachment.metadata.image_name
        : attachment.metadata.type === 'channel'
          ? attachment.metadata.channel_name
          : attachment.metadata.email_subject;
  });

  const block = createMemo(() => {
    const attachment = props.attachment;
    if (!attachment.metadata) return;
    return attachment.metadata.type === 'document'
      ? fileTypeToBlockName(attachment.metadata.document_type)
      : attachment.metadata.type === 'image'
        ? 'image'
        : 'channel';
  });

  const onClick = () => {
    const attachment = props.attachment;
    if (isImageAttachment(attachment)) return;
    const block_ = block();
    if (!block_) return;
    replaceOrInsertSplit({
      id: attachment.attachmentId,
      type: block_,
    });
  };
  return (
    <Switch>
      <Match when={isImageAttachment(props.attachment)}>
        <ImageAttachment
          attachment={props.attachment}
          onRemove={props.onRemove}
        />
      </Match>
      <Match when={true}>
        <div
          class={`
      flex items-center p-1 space-x-2 rounded-lg
      hover:bg-hover hover-transition-bg cursor-default
      text-sm
      `}
          onClick={onClick}
        >
          <Switch>
            <Match
              when={
                props.attachment.metadata?.type === 'channel' &&
                props.attachment.metadata
              }
            >
              {(a) => (
                <div class="flex gap-1 items-center">
                  <Dynamic
                    component={channelTypeIcon(a().channel_type)}
                    width={14}
                    height={14}
                  />
                  <div> {name()}</div>
                </div>
              )}
            </Match>
            <Match
              when={
                props.attachment.metadata?.type === 'document' &&
                props.attachment.metadata
              }
            >
              {(a) => (
                <div class="flex gap-1 items-center">
                  <EntityIcon targetType={a().document_type} />
                  <div>{name()}</div>
                </div>
              )}
            </Match>
            <Match when={props.attachment.attachmentType === 'email'}>
              <div class="flex gap-1 items-center">
                <Envelope class="w-4" />
                <div> {name()}</div>
              </div>
            </Match>
          </Switch>
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

function channelTypeIcon(channelType: ChannelType) {
  switch (channelType) {
    case 'direct_message':
      return User;
    case 'private':
      return ThreeUsersIcon;
    case 'organization':
      return BuildingIcon;
    case 'public':
      return GlobeIcon;
    default:
      return ChannelIcon;
  }
}
