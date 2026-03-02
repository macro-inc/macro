import { cn } from '@ui/utils/classname';
import { tryMacroId } from '@core/user';
import { useDisplayName } from '@core/user';
import { useMessage } from './context';

type SenderNameProps = {
  class?: string;
};

export function SenderName(props: SenderNameProps) {
  const message = useMessage();
  const macroId = () => tryMacroId(message().sender_id);
  const [displayName] = useDisplayName(macroId());

  return (
    <span class={cn('text-sm font-semibold truncate', props.class)}>
      {displayName()}
    </span>
  );
}
