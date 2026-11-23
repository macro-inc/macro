import ArrowCounterClockwiseIcon from '@icon/system/regular/arrow-counter-clockwise.svg?component-solid';
import ExclamationMarkIcon from '@icon/system/regular/exclamation-mark.svg?component-solid';
import SpinnerIcon from '@icon/system/regular/spinner-gap.svg?component-solid';
import XIcon from '@icon/system/regular/x.svg?component-solid';
import { Button } from '@ui';
import { createEffect, type JSX, on, Show } from 'solid-js';

/**
 * The row that covers a composer while it records, laid out like the
 * composer it covers: Cancel where "+" was, a mark for the mode, the
 * timeline, a status, and the primary action where Send was.
 *
 * The row itself takes focus, not a button, so no tooltip opens unasked and
 * focus survives a phase that swaps or disables a button. Escape cancels;
 * Enter and Space on the row run the primary action.
 */
export function RecordingPanel(props: {
  label: string;
  /** Changes whenever a button may have been swapped or disabled. */
  phase: string;
  cancelLabel: string;
  cancelDisabled?: boolean;
  onCancel: () => void;
  mark: JSX.Element;
  children: JSX.Element;
  /** Announced: what the panel is doing (Starting…, Transcribing…). */
  status?: string;
  /** Announced when there is no status: why the last step failed. */
  failure?: string;
  /** Shown, not announced: a timer would be read out every second. */
  time?: string;
  primary: JSX.Element;
  onPrimary: () => void;
  /** The primary action is busy or not ready; Enter and Space wait too. */
  primaryInert?: boolean;
  'data-voice-memo-panel'?: string;
}) {
  let row!: HTMLDivElement;
  const focusRow = () =>
    queueMicrotask(() => {
      if (!row.isConnected) return;
      // A swapped or removed button drops focus to the page; focus the
      // person moved elsewhere stays there.
      const focused = document.activeElement;
      if (!focused || focused === document.body) row.focus();
    });

  createEffect(
    on(
      () => props.phase,
      (_phase, previous) => {
        // Open: take focus from the editor. Later: only if it was lost.
        if (previous === undefined) queueMicrotask(() => row.focus());
        else focusRow();
      }
    )
  );

  return (
    <div
      ref={row}
      tabIndex={-1}
      class="absolute inset-0 z-10 flex items-center gap-2 rounded-[inherit] bg-composer px-[9.375px] text-composer-ink outline-hidden"
      role="group"
      aria-label={props.label}
      aria-keyshortcuts="Enter Escape"
      data-voice-memo-panel={props['data-voice-memo-panel']}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.preventDefault();
          event.stopPropagation();
          if (!props.cancelDisabled) props.onCancel();
          return;
        }
        if (
          event.target === row &&
          (event.key === 'Enter' || event.key === ' ')
        ) {
          event.preventDefault();
          event.stopPropagation();
          if (!props.primaryInert) props.onPrimary();
        }
      }}
    >
      <Button
        aria-label={props.cancelLabel}
        tooltip={props.cancelLabel}
        variant="ghost"
        size="icon-md"
        class="text-composer-ink aria-disabled:opacity-45"
        aria-disabled={props.cancelDisabled}
        onClick={() => {
          if (!props.cancelDisabled) props.onCancel();
        }}
      >
        <XIcon class="size-5 touch:size-6 shrink-0 pointer-events-none" />
      </Button>
      <span
        aria-hidden="true"
        class="flex size-5 shrink-0 items-center justify-center"
      >
        {props.mark}
      </span>
      <div class="flex min-w-0 flex-1 items-center">{props.children}</div>
      <Show when={props.time}>
        <span class="shrink-0 text-xs tabular-nums text-ink-muted">
          {props.time}
        </span>
      </Show>
      <Show when={props.status}>
        <span aria-hidden="true" class="shrink-0 text-xs text-ink-muted">
          {props.status}
        </span>
      </Show>
      {/* Mounted from the start and only ever refilled: a live region that
          arrives with its text already in it goes unannounced. */}
      <span class="sr-only" role="status" aria-live="polite">
        {props.status ?? props.failure ?? ''}
      </span>
      {props.primary}
    </div>
  );
}

/** The panel's main action, drawn like the Send button it replaces. */
export function PrimaryAction(props: {
  label: string;
  /** Working: a spinner, and clicks do nothing. */
  busy?: boolean;
  /** Not ready yet; it stays focusable. */
  unavailable?: boolean;
  onClick: () => void;
  children: JSX.Element;
}) {
  const inert = () => props.busy || props.unavailable;
  return (
    <Button
      aria-label={props.label}
      tooltip={props.label}
      variant="primary"
      finish="flat"
      size="icon-md"
      class="border-0 aria-disabled:cursor-not-allowed aria-disabled:bg-ink-muted/5 aria-disabled:text-ink-extra-muted"
      // Not `disabled`: focus must not fall out of the panel.
      aria-disabled={props.unavailable}
      aria-busy={props.busy}
      onClick={() => {
        if (!inert()) props.onClick();
      }}
    >
      <Show
        when={!props.busy}
        fallback={
          <SpinnerIcon class="size-5 shrink-0 animate-spin touch:size-6 pointer-events-none" />
        }
      >
        {props.children}
      </Show>
    </Button>
  );
}

export function RetryIcon() {
  return (
    <ArrowCounterClockwiseIcon class="size-5 touch:size-6 shrink-0 pointer-events-none" />
  );
}

/** A failure stated in the panel, where the timeline was. */
export function PanelFailure(props: { text: string }) {
  return (
    <span class="min-w-0 flex-1 truncate px-1 text-xs text-failure-ink">
      {props.text}
    </span>
  );
}

export function FailureMark() {
  return <ExclamationMarkIcon class="size-4 text-failure" />;
}
