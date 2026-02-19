import { Show, For } from 'solid-js';
import { cn } from '@ui/utils/classname';
import { useMessage } from './context';

type ReactionsProps = {
  class?: string;
};

export function Reactions(props: ReactionsProps) {
  const message = useMessage();

  return (
    <Show when={message.reactions.length > 0}>
      <div class={cn('flex flex-wrap gap-1 mt-1', props.class)}>
        <For each={message.reactions}>
          {(reaction) => (
            <span class="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-secondary text-xs">
              {reaction.emoji}
              <span class="text-secondary-fg">{reaction.users.length}</span>
            </span>
          )}
        </For>
      </div>
    </Show>
  );
}
