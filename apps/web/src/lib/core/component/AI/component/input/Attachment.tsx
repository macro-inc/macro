import type { Attachment, AttachmentPreview } from '@core/component/AI/types';
import { isImageAttachment } from '@core/component/AI/util/attachment';
import { ImagePreview } from '@core/component/ImagePreview';
import { toast } from '@core/component/Toast/Toast';
import XIcon from '@phosphor/x.svg';
import Spinner from '@phosphor-icons/core/bold/spinner-gap-bold.svg?component-solid';
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
      <For each={props.attached().filter(isImageAttachment)}>
        {(attachment) => (
          <Suspense>
            <ImageAttachment
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

function uploadingFilename(preview: AttachmentPreview): string {
  const metadata = preview.metadata;
  if (!metadata) return 'File';
  if (metadata.type === 'document' && 'document_name' in metadata) {
    return metadata.document_name;
  }
  if (metadata.type === 'image' && 'image_name' in metadata) {
    return metadata.image_name;
  }
  return 'File';
}

function UploadingAttachment(props: AttachmentPreview) {
  return (
    <Switch>
      <Match when={isImageAttachment(props)}>
        <div class="flex flex-col items-center justify-center gap-2 size-15 border border-edge rounded-md bg-surface">
          <Spinner class="size-4 animate-spin text-ink-muted" />
        </div>
      </Match>
      <Match when={!isImageAttachment(props)}>
        <div class="flex items-center gap-1 px-1 py-0.5 text-sm cursor-default border border-edge-muted rounded-xs max-w-full min-w-0">
          <Spinner class="size-4 shrink-0 animate-spin text-ink-muted" />
          <span class="truncate">{uploadingFilename(props)}</span>
        </div>
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
          class="size-6 text-ink absolute -top-2 -right-2 rounded-full bg-surface p-1 border border-edge z-10"
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
