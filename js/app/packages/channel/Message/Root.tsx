import { Show, splitProps, type JSX } from 'solid-js';
import { cn } from '@ui/utils/classname';
import { MessageActionsProvider, MessageProvider } from './context';
import type { MessageActions, MessageData } from './types';

type RootProps = JSX.HTMLAttributes<HTMLDivElement> & {
  message: MessageData;
  actions?: MessageActions;
  highlighted?: boolean;
};

export function Root(props: RootProps) {
  const [local, rest] = splitProps(props, [
    'children',
    'class',
    'message',
    'actions',
    'highlighted',
  ]);

  return (
    <div
      class={cn(
        'group/message relative hover:bg-accent/5 hover:outline-1 hover:outline-accent/20 hover:outline-offset-[-1px]',
        local.class,
        {
          'bg-accent/5 outline-1 outline-accent/20 outline-offset-[-1px]':
            local.highlighted,
        }
      )}
      data-message
      data-message-id={local.message.id}
      {...rest}
    >
      <div
        class={cn(
          'absolute h-full w-[3px] left-0 top-0 bg-accent opacity-0 group-hover/message:opacity-100',
          { 'opacity-100': local.highlighted }
        )}
      />
      <MessageProvider value={() => local.message}>
        <Show when={local.actions !== undefined} fallback={local.children}>
          <MessageActionsProvider value={local.actions}>
            {local.children}
          </MessageActionsProvider>
        </Show>
      </MessageProvider>
    </div>
  );
}
