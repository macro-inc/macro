import { TextShimmer } from '@app/features/block-agent/ui';
import CheckIcon from '@phosphor/check.svg';
import SpinnerIcon from '@phosphor/spinner-gap.svg';
import WarningIcon from '@phosphor/warning-circle.svg';
import XIcon from '@phosphor/x.svg';
import { createSignal, For, Match, Show, Switch } from 'solid-js';

/** One step of an agent's work, as the session's fold worded it. */
export type ActivityRowView = {
  id: string;
  label: string;
  detail?: string | null;
  status: 'running' | 'completed' | 'failed' | 'interrupted';
};

/** Steps shown before the earlier ones fold behind a count. */
const VISIBLE_ROWS = 6;

/**
 * The steps an agent took between two passages of its reply: what it did, to
 * what, and how that went, one quiet line each. A long run keeps its latest
 * steps in view and folds the rest behind a count.
 */
export function ActivityRows(props: { rows: readonly ActivityRowView[] }) {
  const [expanded, setExpanded] = createSignal(false);
  const hidden = () =>
    expanded() ? 0 : Math.max(0, props.rows.length - VISIBLE_ROWS);
  return (
    <ul class="my-1 flex min-w-0 flex-col gap-0.5 text-xs" aria-label="Steps">
      <Show when={hidden() > 0}>
        <li>
          <button
            type="button"
            class="text-ink-extra-muted hover:text-ink-muted"
            onClick={() => setExpanded(true)}
          >
            {hidden()} earlier {hidden() === 1 ? 'step' : 'steps'}
          </button>
        </li>
      </Show>
      <For each={props.rows.slice(hidden())}>
        {(row) => (
          <li
            class="flex min-h-5 min-w-0 items-center gap-2"
            data-status={row.status}
          >
            <StatusIcon status={row.status} />
            <span class="shrink-0 text-ink-muted">
              <TextShimmer text={row.label} active={row.status === 'running'} />
            </span>
            <Show when={row.detail}>
              {(detail) => (
                <span class="min-w-0 truncate font-mono text-ink-extra-muted">
                  {detail()}
                </span>
              )}
            </Show>
          </li>
        )}
      </For>
    </ul>
  );
}

function StatusIcon(props: { status: ActivityRowView['status'] }) {
  return (
    <Switch>
      <Match when={props.status === 'running'}>
        <SpinnerIcon
          class="size-3.5 shrink-0 animate-spin text-ink-muted"
          aria-label="Running"
        />
      </Match>
      <Match when={props.status === 'completed'}>
        <CheckIcon class="size-3.5 shrink-0 text-success" aria-label="Done" />
      </Match>
      <Match when={props.status === 'failed'}>
        <XIcon class="size-3.5 shrink-0 text-failure" aria-label="Failed" />
      </Match>
      <Match when={props.status === 'interrupted'}>
        <WarningIcon
          class="size-3.5 shrink-0 text-ink-muted"
          aria-label="Interrupted: it may or may not have finished"
        />
      </Match>
    </Switch>
  );
}
