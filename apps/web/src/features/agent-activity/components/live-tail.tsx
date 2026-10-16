import { StaticMarkdown } from '@core/component/LexicalMarkdown/component/core/StaticMarkdown';
import { Button } from '@ui';
import { type ParentProps, Show } from 'solid-js';

/**
 * The part of a running reply that is not a message yet: the passage the
 * agent is writing, what it is waiting on (children), and the controls a
 * person who can steer the session has. Finished passages are posted as their
 * own messages, so nothing shown here is shown twice.
 */
export function LiveTail(
  props: ParentProps<{
    /** The unfinished passage, streaming. */
    prose?: string;
    /** The live view stopped updating. */
    disconnected?: boolean;
    onReconnect?: () => void;
    /** Present when the viewer may stop the turn. */
    onStop?: () => void;
    stopping?: boolean;
  }>
) {
  return (
    <div class="flex min-w-0 flex-col gap-2">
      <Show when={props.prose}>
        {(prose) => (
          <div class="min-w-0 text-sm text-ink">
            <StaticMarkdown markdown={prose()} />
          </div>
        )}
      </Show>
      {props.children}
      <Show when={props.disconnected || props.onStop}>
        <div class="flex items-center gap-2 text-xs text-ink-muted">
          <Show when={props.disconnected}>
            <span>Live updates disconnected.</span>
            <Button
              size="xs"
              variant="ghost"
              onClick={() => props.onReconnect?.()}
            >
              Reconnect
            </Button>
          </Show>
          <Show when={props.onStop}>
            {(stop) => (
              <Button
                size="xs"
                variant="ghost"
                disabled={props.stopping}
                onClick={() => stop()()}
              >
                Stop
              </Button>
            )}
          </Show>
        </div>
      </Show>
    </div>
  );
}
