import { Button } from '@ui';
import { createSignal } from 'solid-js';
import { changeSessionArchiveState } from '../queries/change-session-archive-state';

export function ArchivedSessionFooter(props: { sessionId: string }) {
  const [pending, setPending] = createSignal(false);

  const unarchive = async () => {
    setPending(true);
    try {
      await changeSessionArchiveState(props.sessionId, false);
    } finally {
      setPending(false);
    }
  };

  return (
    <div class="flex items-center justify-between gap-4 rounded-xl border border-edge-muted bg-panel px-4 py-3">
      <div class="min-w-0">
        <p class="text-sm font-medium text-ink">This session is archived</p>
        <p class="text-xs text-ink-muted">
          Unarchive it to rename the session or send messages.
        </p>
      </div>
      <Button
        variant="outline"
        size="sm"
        disabled={pending()}
        onClick={unarchive}
      >
        {pending() ? 'Unarchiving…' : 'Unarchive'}
      </Button>
    </div>
  );
}
