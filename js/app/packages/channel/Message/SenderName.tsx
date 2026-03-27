import { cn } from '@ui/utils/classname';
import { tryMacroId } from '@core/user';
import { useDisplayName } from '@core/user';
import { Show } from 'solid-js';
import { useMessage } from './context';

type SenderNameProps = {
  class?: string;
  hidden?: boolean;
};

export function SenderName(props: SenderNameProps) {
  const message = useMessage();
  const macroId = () => tryMacroId(message().sender_id);
  const [displayName] = useDisplayName(macroId());

  return (
    <Show when={!props.hidden}>
      <span class={cn('text-sm font-medium truncate', props.class)}>
        {displayName()}
      </span>
    </Show>
  );
}
