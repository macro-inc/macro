/**
 * Bars above the document: why it is open read-only (with the action that
 * helps), and dismissible notes about how the file was read and will be
 * saved. Presentational.
 */

import Info from '@phosphor/info.svg';
import WarningCircle from '@phosphor/warning-circle.svg';
import XIcon from '@phosphor/x.svg';
import { Button } from '@ui/components/Button';
import { For, Show } from 'solid-js';

export function SessionNotice(props: {
  message: string;
  action: string;
  onAction: () => void;
}) {
  return (
    <div
      role="status"
      class="flex shrink-0 items-center gap-2 border-edge-muted border-b bg-inset px-3 py-1.5 text-ink text-xs"
      data-testid="ai-session-notice"
    >
      <WarningCircle class="size-3.5 shrink-0 text-warning" />
      <span class="min-w-0 flex-1">{props.message}</span>
      <Button
        variant="outline"
        size="sm"
        data-testid="ai-session-action"
        onClick={() => props.onAction()}
      >
        {props.action}
      </Button>
    </div>
  );
}

/** A dismissible note floating over the canvas's top. */
export function FileNotice(props: {
  title: string;
  details?: string[];
  testId: string;
  onDismiss: () => void;
}) {
  return (
    <div
      role="status"
      class="pointer-events-auto flex max-w-md items-start gap-2 rounded-lg border border-edge-muted bg-menu px-3 py-2 text-ink text-xs shadow-lg"
      data-testid={props.testId}
      onPointerDown={(e) => e.stopPropagation()}
    >
      <Info class="mt-0.5 size-3.5 shrink-0 text-accent" />
      <div class="min-w-0 flex-1">
        <p>{props.title}</p>
        <Show when={props.details && props.details.length > 0}>
          <ul class="mt-1 list-disc pl-4 text-ink-muted">
            <For each={props.details}>{(d) => <li>{d}</li>}</For>
          </ul>
        </Show>
      </div>
      <button
        type="button"
        aria-label="Dismiss"
        data-testid={`${props.testId}-dismiss`}
        class="rounded p-0.5 text-ink-muted hover:bg-hover hover:text-ink"
        onClick={() => props.onDismiss()}
      >
        <XIcon class="size-3" />
      </button>
    </div>
  );
}
