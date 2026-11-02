import { Button } from '@ui';
import type { Accessor } from 'solid-js';

export function ShareSheetHeaderActions(props: {
  canSend: Accessor<boolean>;
  handleCancel: () => void;
  handleSend: () => void;
}) {
  return (
    <div class="shrink-0 flex items-center justify-between px-3 pb-3 text-sm font-medium text-ink min-h-11">
      <Button
        variant="ghost"
        size="sm"
        onClick={props.handleCancel}
        class="pl-0"
      >
        Cancel
      </Button>
      <Button
        variant="ghost"
        size="sm"
        class="shrink-0 ml-2 pl-2 disabled:text-ink-muted text-accent"
        disabled={!props.canSend()}
        onClick={(event) => {
          event.preventDefault();
          props.handleSend();
        }}
      >
        Send
      </Button>
    </div>
  );
}
