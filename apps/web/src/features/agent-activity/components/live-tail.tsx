import { Button } from '@ui';
import { type ParentProps, Show } from 'solid-js';

/**
 * What a running turn is waiting on (children), beneath its typing row, and a
 * way back when the live view stopped updating. The reply itself is posted as
 * messages once each passage is finished, so nothing here repeats it.
 */
export function LiveTail(
  props: ParentProps<{
    /** The live view stopped updating. */
    disconnected?: boolean;
    onReconnect?: () => void;
  }>
) {
  return (
    <div class="flex min-w-0 flex-col gap-2">
      {props.children}
      <Show when={props.disconnected}>
        <div class="flex items-center gap-2 text-xs text-ink-muted">
          <span>Live updates disconnected.</span>
          <Button
            size="xs"
            variant="ghost"
            onClick={() => props.onReconnect?.()}
          >
            Reconnect
          </Button>
        </div>
      </Show>
    </div>
  );
}
