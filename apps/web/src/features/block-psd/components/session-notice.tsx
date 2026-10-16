/**
 * A bar above the document explaining why it is open read-only (the sync
 * service is unreachable, or the file was replaced), with the one action
 * that helps. Presentational.
 */

import WarningCircle from '@phosphor/warning-circle.svg';
import { Button } from '@ui/components/Button';

export function SessionNotice(props: {
  message: string;
  action: string;
  onAction: () => void;
}) {
  return (
    <div
      role="status"
      class="flex shrink-0 items-center gap-2 border-edge-muted border-b bg-inset px-3 py-1.5 text-ink text-xs"
      data-testid="psd-session-notice"
    >
      <WarningCircle class="size-3.5 shrink-0 text-warning" />
      <span class="min-w-0 flex-1">{props.message}</span>
      <Button
        variant="outline"
        size="sm"
        data-testid="psd-session-action"
        onClick={() => props.onAction()}
      >
        {props.action}
      </Button>
    </div>
  );
}
