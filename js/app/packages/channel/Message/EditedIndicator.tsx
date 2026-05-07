import { cn } from '@ui';
import { Show } from 'solid-js';
import { useMessage } from './context';

type EditedIndicatorProps = {
  class?: string;
};

export function EditedIndicator(props: EditedIndicatorProps) {
  const message = useMessage();

  return (
    <Show when={message().edited_at != null}>
      <span class={cn('text-xs text-ink-placeholder', props.class)}>
        (edited)
      </span>
    </Show>
  );
}
