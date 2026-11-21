import { EntityIcon } from '@core/component/EntityIcon';
import Spinner from '@icon/system/regular/spinner-gap.svg';
import Close from '@icon/system/regular/x.svg';
import { Button } from '@ui';
import { Show } from 'solid-js';
import type { InputAttachmentData } from '../types';

type AttachmentChipProps = {
  attachment: InputAttachmentData;
  onOpen?: () => void;
  onRemove: (attachment: InputAttachmentData) => void;
};

/** Compact filename presentation; upload and media-viewer ownership stay in Input. */
export function AttachmentChip(props: AttachmentChipProps) {
  const label = () => (
    <>
      <Show
        when={!props.attachment.pending}
        fallback={<Spinner class="size-3.5 animate-spin" />}
      >
        <EntityIcon
          targetType={props.attachment.iconType ?? 'unknown'}
          size="xs"
        />
      </Show>
      <span class="max-w-40 truncate text-sm text-ink-muted">
        {props.attachment.name}
      </span>
    </>
  );
  return (
    <div class="ph-no-capture flex h-8 items-center gap-1.5 rounded-xl bg-active pl-2.5 pr-1">
      <Show
        when={props.onOpen}
        fallback={
          <div class="flex min-w-0 items-center gap-1.5">{label()}</div>
        }
      >
        <Button
          variant="ghost"
          size="sm"
          class="-my-0.5 min-w-0 px-0 font-normal"
          onClick={props.onOpen}
        >
          {label()}
        </Button>
      </Show>
      <Button
        variant="ghost"
        size="icon-xs"
        class="-my-0.5"
        aria-label={`Remove ${props.attachment.name}`}
        onClick={(event) => {
          event.stopPropagation();
          props.onRemove(props.attachment);
        }}
      >
        <Close class="size-3.5 text-ink-muted" />
      </Button>
    </div>
  );
}
