import { splitProps, type JSX } from 'solid-js';
import { cn } from '@ui/utils/classname';
import { MessageProvider } from './context';
import type { MessageData } from './types';

type RootProps = JSX.HTMLAttributes<HTMLDivElement> & {
  message: MessageData;
};

export function Root(props: RootProps) {
  const [local, rest] = splitProps(props, ['children', 'class', 'message']);

  return (
    <div
      class={cn(local.class)}
      data-message-id={local.message.id}
      {...rest}
    >
      <MessageProvider value={local.message}>
        {local.children}
      </MessageProvider>
    </div>
  );
}
