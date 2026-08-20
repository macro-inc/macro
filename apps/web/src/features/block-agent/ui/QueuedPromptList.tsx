/**
 * Prompts waiting to be sent, shown above the composer so a queued message
 * is never invisible: the user can see it, remove it, and — when the send
 * failed — retry it. Pure component: props in, JSX out.
 */

import ArrowClockwise from '@phosphor/arrow-clockwise.svg';
import X from '@phosphor/x.svg';
import { Button } from '@ui';
import { For, Show } from 'solid-js';

export interface QueuedPromptListProps {
  prompts: { id: string; markdown: string }[];
  /** The prompt currently on the wire — its row reads "Sending". */
  sendingId?: string;
  /** The head prompt failed to send — its row reads "Failed" with a retry. */
  failed?: boolean;
  onRetry?: () => void;
  onRemove?: (id: string) => void;
}

/** The first non-empty line, for a one-line preview of a markdown prompt. */
function firstLine(markdown: string): string {
  return (
    markdown
      .split('\n')
      .map((line) => line.trim())
      .find((line) => line.length > 0) ?? markdown
  );
}

export function QueuedPromptList(props: QueuedPromptListProps) {
  return (
    <Show when={props.prompts.length > 0}>
      <div class="flex flex-col gap-1 pb-2">
        <For each={props.prompts}>
          {(prompt, index) => {
            const failed = () => props.failed === true && index() === 0;
            const sending = () => props.sendingId === prompt.id;
            return (
              <div class="flex items-center gap-2 rounded-lg border border-edge-muted bg-hover px-3 py-1.5 text-sm">
                <span class="min-w-0 flex-1 truncate text-ink-muted">
                  {firstLine(prompt.markdown)}
                </span>
                <Show when={sending()}>
                  <span class="shrink-0 text-xs text-ink-extra-muted">
                    Sending
                  </span>
                </Show>
                <Show when={failed()}>
                  <span class="shrink-0 text-xs text-ink">Failed</span>
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    label="Retry"
                    onClick={() => props.onRetry?.()}
                  >
                    <ArrowClockwise />
                  </Button>
                </Show>
                <Show when={!sending()}>
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    label="Remove"
                    onClick={() => props.onRemove?.(prompt.id)}
                  >
                    <X />
                  </Button>
                </Show>
              </div>
            );
          }}
        </For>
      </div>
    </Show>
  );
}
