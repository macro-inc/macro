import { activityRuns } from '@app/features/block-agent/state/code-execution';
import { TextShimmer } from '@app/features/block-agent/ui';
import { Key } from '@solid-primitives/keyed';
import { Match, Show, Switch } from 'solid-js';

/**
 * One step of an agent's work, as the session's fold worded it. A
 * conversation names the step only: what it ran or read stays in the session.
 */
export type ActivityRowView = {
  id: string;
  label: string;
  status: 'running' | 'completed' | 'failed' | 'interrupted';
  /** What the step put in front of the person; see `AgentActivity`. */
  card?: unknown;
};

/**
 * The steps an agent took between two passages of its reply, one quiet line
 * each like the session's tool rows: what it did, and how it went only when
 * it did not simply finish. A step repeated back to back is one line with
 * its count.
 */
export function ActivityRows(props: { rows: readonly ActivityRowView[] }) {
  return (
    <ul class="my-1 flex min-w-0 flex-col gap-0.5" aria-label="Steps">
      {/* Rows can arrive as new objects with every paint. Keyed by step, a
          row updates in place and its shimmer runs on. */}
      <Key each={activityRuns(props.rows)} by={(run) => run.item.id}>
        {(run) => (
          <li
            class="flex min-h-6 min-w-0 items-center gap-1.5"
            data-status={run().item.status}
          >
            <span class="shrink-0">
              <TextShimmer
                text={run().item.label}
                active={run().item.status === 'running'}
              />
            </span>
            <Show when={run().count > 1}>
              <span class="shrink-0 text-ink-extra-muted tabular-nums">
                {`×${run().count}`}
              </span>
            </Show>
            <Switch>
              <Match when={run().item.status === 'failed'}>
                <span class="shrink-0 text-failure">Failed</span>
              </Match>
              <Match when={run().item.status === 'interrupted'}>
                <span class="shrink-0 text-ink-disabled">Interrupted</span>
              </Match>
            </Switch>
          </li>
        )}
      </Key>
    </ul>
  );
}
