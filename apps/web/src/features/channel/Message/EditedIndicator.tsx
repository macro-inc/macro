import { isBotSenderId } from '@queries/channel/message-sender';
import { cn } from '@ui';
import { Show } from 'solid-js';
import { useMessage } from './context';

type EditedIndicatorProps = {
  class?: string;
};

export function EditedIndicator(props: EditedIndicatorProps) {
  const message = useMessage();

  // Macro edits its own "thinking" message into the answer; that isn't a
  // user edit, so don't surface an "(edited)" marker for bot senders.
  return (
    <Show
      when={message().edited_at != null && !isBotSenderId(message().sender_id)}
    >
      <span class={cn('text-xs text-ink-placeholder', props.class)}>
        (edited)
      </span>
    </Show>
  );
}
