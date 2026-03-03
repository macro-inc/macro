import { For, Show, splitProps, type JSX } from 'solid-js';
import { cn } from '@ui/utils/classname';
import {
  useInput,
  useInputActions,
  useInputAttachmentTracker,
} from './context';
import type { InputAttachmentData, InputAttachmentKind } from './types';
import XIcon from '@icon/regular/x.svg';
import SpinnerIcon from '@icon/bold/spinner-gap-bold.svg';
import { renderIcon } from './render-icon';

type AttachmentsProps = JSX.HTMLAttributes<HTMLDivElement> & {
  kind?: InputAttachmentKind;
};

export function Attachments(props: AttachmentsProps) {
  const input = useInput();
  const actions = useInputActions();
  const attachmentTracker = useInputAttachmentTracker();
  const [local, rest] = splitProps(props, ['class', 'children', 'kind']);

  const visibleAttachments = () => {
    const items = attachmentTracker?.attachments() ?? input().attachments ?? [];
    if (!local.kind) return items;
    return items.filter((attachment) => attachment.kind === local.kind);
  };

  const handleRemove = (
    event: MouseEvent | KeyboardEvent,
    attachment: InputAttachmentData
  ) => {
    attachmentTracker?.removeAttachment(attachment.id);
    void actions?.onRemoveAttachment?.({ input: input(), event, attachment });
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
          when={local.children}
          fallback={
            <For each={visibleAttachments()}>
              {(attachment) => (
                <div class="group flex items-center px-1 space-x-1 hover:bg-hover hover-transition-bg cursor-default text-sm border border-edge-muted rounded-xs">
                  <Show when={attachment.pending}>
                    {renderIcon(SpinnerIcon, 'w-4 h-4 animate-spin')}
                  </Show>
                  <span class="truncate max-w-[16rem]">{attachment.name}</span>
                  <Show when={actions?.onRemoveAttachment}>
                    <div
                      role="button"
                      tabindex={0}
                      class="hover:bg-hover hover-transition-bg rounded-md p-1 items-center flex"
                      onClick={(event) => handleRemove(event, attachment)}
                      onKeyDown={(event) => {
                        if (event.key !== 'Enter' && event.key !== ' ') return;
                        handleRemove(event, attachment);
                      }}
                    >
                      {renderIcon(
                        XIcon,
                        'text-ink-muted group-hover:text-failure size-3'
                      )}
                    </div>
                  </Show>
                </div>
              )}
            </For>
          }
        >
          {local.children}
        </Show>
      </div>
    </Show>
  );
}
