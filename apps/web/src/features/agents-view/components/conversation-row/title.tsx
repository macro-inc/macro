import { cn } from '@ui';
import { useConversationRow } from './context';

export function ConversationRowTitle() {
  const row = useConversationRow();
  return (
    <span
      class={cn(
        'pointer-events-none relative min-w-0 flex-1 truncate text-sm font-normal text-ink',
        row.untitled && 'text-ink-extra-muted'
      )}
    >
      {row.title}
    </span>
  );
}
