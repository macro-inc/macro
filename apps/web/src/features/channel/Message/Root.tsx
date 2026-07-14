import { cn } from '@ui';
import { type JSX, splitProps } from 'solid-js';
import { MessageActionsProvider, MessageProvider } from './context';
import type { MessageActions, MessageData } from './types';

type RootProps = JSX.HTMLAttributes<HTMLDivElement> & {
  message: MessageData;
  actions?: MessageActions;
  /** This message is the selection cursor. Renders the background highlight. */
  selected?: boolean;
  /**
   * The unified-input mode's floating reply/edit input, or message
   * navigation, points at this message. Renders the accent bar.
   */
  targeted?: boolean;
};

export function Root(props: RootProps) {
  const [local, rest] = splitProps(props, [
    'children',
    'class',
    'message',
    'actions',
    'selected',
    'targeted',
  ]);

  return (
    <div
      class={cn('group/message relative touch:no-select-children', local.class)}
      data-message
      data-message-id={local.message.id}
      data-selected={local.selected ? '' : undefined}
      data-targeted={local.targeted ? '' : undefined}
      {...rest}
    >
      <div class="absolute h-full w-1 left-0 top-0 bg-accent opacity-0 message-accent-bar" />
      <MessageProvider value={() => local.message}>
        <MessageActionsProvider value={local.actions}>
          {props.children}
        </MessageActionsProvider>
      </MessageProvider>
    </div>
  );
}
