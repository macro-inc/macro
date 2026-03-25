import { Show } from 'solid-js';
import { cn } from '@ui/utils/classname';
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
