import { Button } from '@ui';
import { type JSX, type ParentProps, Show } from 'solid-js';
import { ActivityLine } from './activity-line';
import type { ActivityRowView } from './activity-rows';

/**
 * An agent at work in a conversation, in one row under its newest message:
 * its avatar beside the working line, and Stop for a viewer who may stop it.
 * Anything the agent is waiting on renders beneath as children.
 */
export function TypingRow(
  props: ParentProps<{
    avatar: JSX.Element;
    rows: readonly ActivityRowView[];
    /** Present when the viewer may stop the turn. */
    onStop?: () => void;
    stopping?: boolean;
  }>
) {
  return (
    <div
      class="flex min-w-0 items-start gap-2 px-[var(--message-padding-x)] py-1"
      data-agent-typing
    >
      {/* As tall as the working line, so the avatar sits level with it. */}
      <div class="flex h-8 w-[var(--user-icon-width)] shrink-0 items-center justify-center">
        {props.avatar}
      </div>
      <div class="min-w-0 flex-1">
        <div class="flex min-w-0 items-center gap-2">
          <div class="min-w-0 flex-1">
            <ActivityLine rows={props.rows} />
          </div>
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
        {props.children}
      </div>
    </div>
  );
}
