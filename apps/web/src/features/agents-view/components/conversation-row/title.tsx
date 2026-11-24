import { cn } from '@ui';
import { useConversationRow, useConversationRowTitleRef } from './context';

export function ConversationRowTitle() {
  const row = useConversationRow();
  const setTitleElement = useConversationRowTitleRef();
  return (
    <span
      ref={setTitleElement}
      class={cn(
        'pointer-events-none relative min-w-0 flex-1 truncate text-sm font-normal text-ink',
        row.untitled && 'text-ink-extra-muted'
      )}
    >
      {row.title}
    </span>
  );
}
