import { TextShimmer } from '@app/features/block-agent/ui';
import { Key } from '@solid-primitives/keyed';

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
 * each like the session's tool rows: what it did. How a step ended stays in
 * `data-status`; a failure is the agent's to explain in its reply.
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
          </li>
        )}
      </Key>
    </ul>
  );
}
