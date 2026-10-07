import EyeSlashIcon from '@phosphor/eye-slash.svg';
import WarningIcon from '@phosphor/warning-circle.svg';
import XIcon from '@phosphor/x.svg';
import { Button } from '@ui/components/Button';
import { Show } from 'solid-js';

/** A column change the server refused. */
export function SchemaErrorNotice(props: { message: string }) {
  return (
    <p
      role="alert"
      class="border-b border-edge-muted px-5 py-2 text-xs text-failure-ink"
    >
      {props.message}
    </p>
  );
}

/**
 * A write that failed, or whose outcome is unknown. `onDiscard` offers to drop
 * the draft row an unknown create left behind.
 */
export function SaveFailureNotice(props: {
  title: string;
  message: string;
  actionLabel: string;
  pending: boolean;
  onAction: () => void;
  onDiscard?: () => void;
  onDismiss: () => void;
}) {
  return (
    <div
      role="alert"
      class="flex shrink-0 items-start gap-2 border-b border-warning/20 bg-warning/5 px-5 py-3 text-xs"
    >
      <WarningIcon class="mt-0.5 size-4 shrink-0 text-warning-ink" />
      <div class="min-w-0 flex-1">
        <p class="font-medium text-ink">{props.title}</p>
        <p class="mt-1 text-ink-muted">{props.message}</p>
      </div>
      <Button
        size="xs"
        class="shrink-0"
        disabled={props.pending}
        onClick={props.onAction}
      >
        {props.actionLabel}
      </Button>
      <Show when={props.onDiscard}>
        {(discard) => (
          <Button
            size="xs"
            class="shrink-0"
            disabled={props.pending}
            onClick={() => discard()()}
          >
            Discard draft
          </Button>
        )}
      </Show>
      <Button
        size="icon-xs"
        label="Dismiss save error"
        tooltipDisabled
        onClick={props.onDismiss}
      >
        <XIcon class="size-3.5" />
      </Button>
    </div>
  );
}

/** Rows on screen that may be behind the server. */
export function RefreshNotice(props: { onRefresh: () => void }) {
  return (
    <div
      role="status"
      class="flex shrink-0 items-center gap-2 border-b border-edge-muted px-5 py-2 text-xs text-ink-muted"
    >
      The latest data could not be refreshed.
      <Button
        variant="ghost"
        size="xs"
        class="text-accent"
        onClick={props.onRefresh}
      >
        Refresh
      </Button>
    </div>
  );
}

/** A record just saved that the view does not show. */
export function HiddenRecordNotice(props: {
  title: string;
  message: string;
  onOpen: () => void;
  onDismiss: () => void;
}) {
  return (
    <div
      role="status"
      class="flex shrink-0 items-start gap-2 border-b border-edge-muted bg-accent/5 px-5 py-3 text-xs"
    >
      <EyeSlashIcon class="mt-0.5 size-4 shrink-0 text-ink-muted" />
      <div class="min-w-0 flex-1">
        <p class="font-medium text-ink">{props.title}</p>
        <p class="mt-1 text-ink-muted">{props.message}</p>
      </div>
      <Button size="xs" class="shrink-0 text-accent" onClick={props.onOpen}>
        Open record
      </Button>
      <Button
        size="icon-xs"
        label="Dismiss record notice"
        tooltipDisabled
        onClick={props.onDismiss}
      >
        <XIcon class="size-3.5" />
      </Button>
    </div>
  );
}

/** A draft row that could not be created. */
export function DraftFailureNotice(props: {
  message: string;
  actionLabel: string;
  pending: boolean;
  onAction: () => void;
  onDiscard?: () => void;
}) {
  return (
    <div
      role="alert"
      class="flex items-center gap-3 border-b border-edge-muted px-4 py-2 text-xs text-ink-muted"
    >
      <span class="flex-1">{props.message}</span>
      <Button size="xs" disabled={props.pending} onClick={props.onAction}>
        {props.actionLabel}
      </Button>
      <Show when={props.onDiscard}>
        {(discard) => (
          <Button
            size="xs"
            disabled={props.pending}
            onClick={() => discard()()}
          >
            Discard draft
          </Button>
        )}
      </Show>
    </div>
  );
}
