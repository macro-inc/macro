import { useMessageUnsent } from '@queries/messages/unsent';
import { cn } from '@ui';
import { Show } from 'solid-js';
import { useMessage } from './context';

type UnsentIndicatorProps = {
  class?: string;
};

/**
 * Marks a message this session is still trying to send. `Message.Root` dims
 * the row while this label is in it.
 */
export function UnsentIndicator(props: UnsentIndicatorProps) {
  const message = useMessage();
  const unsent = useMessageUnsent(() => message().id);

  return (
    <Show when={unsent()}>
      <span
        class={cn('text-xs text-ink-extra-muted', props.class)}
        data-message-unsent
      >
        Not sent yet
      </span>
    </Show>
  );
}
