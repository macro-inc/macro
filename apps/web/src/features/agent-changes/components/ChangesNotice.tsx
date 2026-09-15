import ArrowsClockwiseIcon from '@phosphor/arrows-clockwise.svg';
import CircleNotchIcon from '@phosphor/circle-notch.svg';
import GitBranchIcon from '@phosphor/git-branch.svg';
import WarningCircleIcon from '@phosphor/warning-circle.svg';
import { Button } from '@ui';
import { type JSX, Show } from 'solid-js';

/** A full-pane message for the states with nothing to diff. */
export function ChangesNotice(props: {
  icon?: JSX.Element;
  title: string;
  detail?: string;
  /** Show the retry action. */
  onRefresh?: () => void;
  refreshing?: boolean;
}) {
  return (
    <div class="flex flex-1 flex-col items-center justify-center gap-2 px-6 py-10 text-center">
      <span class="text-ink-placeholder [&>svg]:size-6">
        {props.icon ?? <GitBranchIcon />}
      </span>
      <p class="text-sm font-medium text-ink">{props.title}</p>
      <Show when={props.detail}>
        <p class="max-w-sm text-xs leading-relaxed text-ink-muted">
          {props.detail}
        </p>
      </Show>
      <Show when={props.onRefresh}>
        <Button
          variant="outline"
          size="sm"
          class="mt-2 gap-1.5"
          disabled={props.refreshing}
          onClick={() => props.onRefresh?.()}
        >
          <ArrowsClockwiseIcon
            class={props.refreshing ? 'animate-spin' : undefined}
          />
          <span>Capture again</span>
        </Button>
      </Show>
    </div>
  );
}

/** A thin strip over the diff stack while a capture runs or after one failed. */
export function CaptureBanner(props: {
  tone: 'progress' | 'failure';
  text: string;
  onRefresh?: () => void;
  refreshing?: boolean;
}) {
  return (
    <div
      class={
        props.tone === 'failure'
          ? 'flex shrink-0 items-center gap-2 border-b border-edge-muted bg-failure-bg px-3 py-1.5 text-xs text-failure'
          : 'flex shrink-0 items-center gap-2 border-b border-edge-muted bg-accent-bg px-3 py-1.5 text-xs text-accent'
      }
      role="status"
    >
      {props.tone === 'failure' ? (
        <WarningCircleIcon class="size-3.5 shrink-0" />
      ) : (
        <CircleNotchIcon class="size-3.5 shrink-0 animate-spin" />
      )}
      <span class="min-w-0 flex-1 truncate" title={props.text}>
        {props.text}
      </span>
      <Show when={props.onRefresh}>
        <Button
          variant="ghost"
          size="xs"
          class="text-current"
          disabled={props.refreshing}
          onClick={() => props.onRefresh?.()}
        >
          Try again
        </Button>
      </Show>
    </div>
  );
}
