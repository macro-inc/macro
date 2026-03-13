import {
  children,
  For,
  Match,
  Show,
  splitProps,
  Switch,
  type JSX,
} from 'solid-js';
import { EntityIcon } from '@core/component/EntityIcon';
import { ImagePreview } from '@core/component/ImagePreview';
import { VideoPreview } from '@core/component/VideoPreview';
import { cn } from '@ui/utils/classname';
import { useInput, useInputCommands } from './context';
import type { InputAttachmentData, InputAttachmentKind } from './types';
import XIcon from '@icon/regular/x.svg';
import SpinnerIcon from '@icon/bold/spinner-gap-bold.svg';

type AttachmentsProps = JSX.HTMLAttributes<HTMLDivElement> & {
  kind?: InputAttachmentKind | 'media';
};

function RemoveButton(props: {
  attachment: InputAttachmentData;
  onRemove: (attachment: InputAttachmentData) => void;
  class?: string;
}) {
  return (
    <button
      type="button"
      class={cn(
        'hover:bg-hover hover-transition-bg rounded-md p-1 items-center flex',
        props.class
      )}
      onClick={(event) => {
        event.stopPropagation();
        props.onRemove(props.attachment);
      }}
      aria-label={`Remove ${props.attachment.name}`}
    >
      <XIcon class="text-ink-muted group-hover:text-failure size-3" />
    </button>
  );
}

function MediaAttachmentItem(props: {
  attachment: InputAttachmentData;
  onRemove: (attachment: InputAttachmentData) => void;
}) {
  return (
    <div class="relative group">
      <RemoveButton
        attachment={props.attachment}
        onRemove={props.onRemove}
        class="absolute -top-2 -right-2 z-[10] rounded-full bg-menu border border-edge-muted opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
      />
      <Show
        when={!props.attachment.pending && props.attachment.kind === 'image'}
        fallback={
          <Show
            when={
              !props.attachment.pending && props.attachment.kind === 'video'
            }
            fallback={
              <div class="flex flex-col items-center justify-center gap-2 w-[60px] h-[60px] border border-edge-muted rounded-md bg-menu">
                <SpinnerIcon class="w-4 h-4 animate-spin" />
              </div>
            }
          >
            <VideoPreview id={props.attachment.id} variant="small" />
          </Show>
        }
      >
        <ImagePreview image={{ id: props.attachment.id }} variant="small" />
      </Show>
    </div>
  );
}

function DocumentAttachmentItem(props: {
  attachment: InputAttachmentData;
  onRemove: (attachment: InputAttachmentData) => void;
}) {
  return (
    <div class="group flex items-center px-2 py-1.5 space-x-1.5 hover:bg-hover hover-transition-bg cursor-default text-sm border border-edge-muted rounded-xs">
      <Show
        when={!props.attachment.pending}
        fallback={<SpinnerIcon class="w-4 h-4 animate-spin" />}
      >
        <EntityIcon
          targetType={props.attachment.iconType ?? 'unknown'}
          size="xs"
        />
      </Show>
      <span class="truncate max-w-[16rem]">{props.attachment.name}</span>
      <RemoveButton attachment={props.attachment} onRemove={props.onRemove} />
    </div>
  );
}

export function Attachments(props: AttachmentsProps) {
  const input = useInput();
  const commands = useInputCommands();
  const [local, rest] = splitProps(props, ['class', 'children', 'kind']);
  const resolved = children(() => local.children);

  const visibleAttachments = () => {
    const items = input().attachments ?? [];
    if (!local.kind) return items;
    if (local.kind === 'media') {
      return items.filter(
        (attachment) =>
          attachment.kind === 'image' || attachment.kind === 'video'
      );
    }
    return items.filter((attachment) => attachment.kind === local.kind);
  };

  const handleRemove = (attachment: InputAttachmentData) => {
    commands.removeAttachment(attachment);
  };

  return (
    <Show when={visibleAttachments().length > 0}>
      <div
        class={cn(
          'flex flex-row w-full px-2 py-1 gap-2 flex-wrap',
          local.class
        )}
        data-input-attachments={local.kind ?? 'all'}
        {...rest}
      >
        <Show
          when={resolved()}
          fallback={
            <For each={visibleAttachments()}>
              {(attachment) => (
                <Switch>
                  <Match
                    when={
                      attachment.kind === 'image' || attachment.kind === 'video'
                    }
                  >
                    <MediaAttachmentItem
                      attachment={attachment}
                      onRemove={handleRemove}
                    />
                  </Match>
                  <Match when={attachment.kind === 'document'}>
                    <DocumentAttachmentItem
                      attachment={attachment}
                      onRemove={handleRemove}
                    />
                  </Match>
                </Switch>
              )}
            </For>
          }
        >
          {(children) => children()}
        </Show>
      </div>
    </Show>
  );
}
