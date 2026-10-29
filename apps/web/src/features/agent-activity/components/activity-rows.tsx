import { TextShimmer } from '@app/features/block-agent/ui';
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
 * The steps an agent took between two passages of its reply, one quiet line
 * each like the session's tool rows: what it did, to what in a dimmer tone,
 * and how it went only when it did not simply finish.
 */
export function ActivityRows(props: { rows: readonly ActivityRowView[] }) {
  return (
    <ul class="my-1 flex min-w-0 flex-col gap-0.5" aria-label="Steps">
      {/* Rows can arrive as new objects with every paint. Keyed by step, a
          row updates in place and its shimmer runs on. */}
      <Key each={props.rows} by="id">
        {(row) => (
          <li
            class="flex min-h-6 min-w-0 items-center gap-1.5"
            data-status={row().status}
          >
            <span class="shrink-0">
              <TextShimmer
                text={row().label}
                active={row().status === 'running'}
              />
            </span>
            <Show when={row().detail}>
              {(detail) => (
                <span class="min-w-0 truncate text-ink-disabled">
                  {detail()}
                </span>
              )}
            </Show>
            <Switch>
              <Match when={row().status === 'failed'}>
                <span class="shrink-0 text-failure">Failed</span>
              </Match>
              <Match when={row().status === 'interrupted'}>
                <span class="shrink-0 text-ink-disabled">Interrupted</span>
              </Match>
            </Switch>
          </li>
        )}
      </Key>
    </ul>
  );
}
