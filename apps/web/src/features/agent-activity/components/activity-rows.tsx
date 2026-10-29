import { TextShimmer } from '@app/features/block-agent/ui';
import CheckIcon from '@icon/system/regular/check.svg';
import SpinnerIcon from '@icon/system/regular/spinner-gap.svg';
import WarningIcon from '@icon/system/regular/warning-circle.svg';
import XIcon from '@icon/system/regular/x.svg';
import { Key } from '@solid-primitives/keyed';
import { Match, Show, Switch } from 'solid-js';

/** One step of an agent's work, as the session's fold worded it. */
export type ActivityRowView = {
  id: string;
  label: string;
  detail?: string | null;
  status: 'running' | 'completed' | 'failed' | 'interrupted';
};

/**
 * The steps an agent took between two passages of its reply: what it did, to
 * what, and how that went, one quiet line each.
 */
export function ActivityRows(props: { rows: readonly ActivityRowView[] }) {
  return (
    <ul class="my-1 flex min-w-0 flex-col gap-0.5 text-sm" aria-label="Steps">
      {/* Rows can arrive as new objects with every paint. Keyed by step, a
          row updates in place and its spinner and shimmer run on. */}
      <Key each={props.rows} by="id">
        {(row) => (
          <li
            class="flex min-h-6 min-w-0 items-center gap-2"
            data-status={row().status}
          >
            <StatusIcon status={row().status} />
            <span class="shrink-0 text-ink-muted">
              <TextShimmer
                text={row().label}
                active={row().status === 'running'}
              />
            </span>
            <Show when={row().detail}>
              {(detail) => (
                <span class="min-w-0 truncate font-mono text-ink-extra-muted">
                  {detail()}
                </span>
              )}
            </Show>
          </li>
        )}
      </Key>
    </ul>
  );
}

function StatusIcon(props: { status: ActivityRowView['status'] }) {
  return (
    <Switch>
      <Match when={props.status === 'running'}>
        <SpinnerIcon
          aria-hidden={false}
          class="size-4 shrink-0 animate-spin text-ink-muted"
          aria-label="Running"
        />
      </Match>
      <Match when={props.status === 'completed'}>
        <CheckIcon
          aria-hidden={false}
          class="size-4 shrink-0 text-success"
          aria-label="Done"
        />
      </Match>
      <Match when={props.status === 'failed'}>
        <XIcon
          aria-hidden={false}
          class="size-4 shrink-0 text-failure"
          aria-label="Failed"
        />
      </Match>
      <Match when={props.status === 'interrupted'}>
        <WarningIcon
          aria-hidden={false}
          class="size-4 shrink-0 text-ink-muted"
          aria-label="Interrupted: it may or may not have finished"
        />
      </Match>
    </Switch>
  );
}
