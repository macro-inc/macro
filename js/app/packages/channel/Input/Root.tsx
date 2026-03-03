import { Show, splitProps, type JSX } from 'solid-js';
import { cn } from '@ui/utils/classname';
import {
  InputActionsProvider,
  InputAttachmentTrackerProvider,
  InputProvider,
} from './context';
import type { InputActions, InputAttachmentTracker, InputData } from './types';

type RootProps = JSX.HTMLAttributes<HTMLDivElement> & {
  input: InputData;
  actions?: InputActions;
  attachmentTracker?: InputAttachmentTracker;
};

export function Root(props: RootProps) {
  const [local, rest] = splitProps(props, [
    'children',
    'class',
    'input',
    'actions',
    'attachmentTracker',
  ]);

  return (
    <div
      class={cn(
        'relative macro-message-width flex flex-col flex-1 items-center justify-between bg-input border border-edge-muted rounded-[5px]',
        local.class,
        {
          'rounded-b-[5px] border-b mb-4': local.input.isReplyInput,
        }
      )}
      data-input
      data-input-id={local.input.id}
      {...rest}
    >
      <InputProvider value={() => local.input}>
        <InputAttachmentTrackerProvider value={local.attachmentTracker}>
          <Show when={local.actions !== undefined} fallback={local.children}>
            <InputActionsProvider value={local.actions}>
              {local.children}
            </InputActionsProvider>
          </Show>
        </InputAttachmentTrackerProvider>
      </InputProvider>
    </div>
  );
}
