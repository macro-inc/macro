import { sessionRowStatus } from '../../core/session-status';
import { SessionStatusGlyph } from '../session-status-glyph/session-status-glyph';
import { useConversationRow } from './context';

export function ConversationRowStatus() {
  const row = useConversationRow();
  return (
    <span class="pointer-events-none relative flex size-(--sidebar-icon-slot) shrink-0 items-center justify-center">
      <SessionStatusGlyph
        state={sessionRowStatus(
          row.state,
          !!row.failed,
          !!row.unread,
          !!row.waiting
        )}
      />
    </span>
  );
}
