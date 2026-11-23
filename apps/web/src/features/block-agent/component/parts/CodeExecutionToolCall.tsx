import type {
  ExecutionActivity,
  ExecutionRecord,
  RecordedToolCall,
} from '@service-agent-harness/generated/schemas';
import { Key } from '@solid-primitives/keyed';
import { For, Show } from 'solid-js';
import { activityRuns, programEnded } from '../../state/code-execution';
import { isToolActive, ToolCard, type ToolStatus } from '../../ui';
import { MacroToolCall } from './MacroToolCall';
import type { ToolCallCommon, ToolCallContext } from './shared';

/**
 * A program's steps, as rows of the tool group it belongs to: each observed
 * operation, historical calls with their registered Macro result components,
 * or one failed row when it ended without any. The program itself is never
 * shown.
 */
export function CodeExecutionToolCall(props: {
  common: ToolCallCommon;
  context: ToolCallContext;
  record?: ExecutionRecord;
  error?: string | null;
  loading: boolean;
  unavailable: boolean;
}) {
  const calls = () => props.record?.calls ?? [];
  const activity = () => props.record?.activity ?? [];
  const runs = () => activityRuns(activity());
  const ended = () =>
    programEnded({
      error: props.error,
      recordRunning: props.record?.status === 'running',
      active: isToolActive(props.common.status),
    });

  return (
    <div
      class="flex min-w-0 flex-col"
      data-code-execution={props.record?.executionId}
    >
      <Show when={activity().length === 0 && calls().length === 0 && ended()}>
        <ToolCard
          title="Workspace activity"
          status={props.common.status}
          muted={props.common.muted}
          trailing={props.common.trailing}
        />
      </Show>
      {/* Runs are new objects with every poll. Keyed by their first step, a
          row updates its count in place. */}
      <Key each={runs()} by={(run) => run.item.id}>
        {(run) => (
          <div class="min-h-8 shrink-0">
            <ActivityRow
              item={run().item}
              count={run().count}
              turnActive={isToolActive(props.common.status)}
            />
          </div>
        )}
      </Key>
      <Show when={props.record?.activityTruncated}>
        <p class="text-xs text-ink-extra-muted">
          Only the first 128 steps are listed.
        </p>
      </Show>
      <Show when={props.loading}>
        <p class="text-xs text-ink-extra-muted" role="status">
          Loading tool results…
        </p>
      </Show>
      <Show when={props.unavailable}>
        <p class="text-xs text-ink-extra-muted" role="status">
          Tool results are unavailable.
        </p>
      </Show>
      <For each={calls()}>
        {(call, index) => (
          <RecordedCall
            call={call}
            context={{
              ...props.context,
              followedBy: (name) =>
                calls()
                  .slice(index() + 1)
                  .some((later) => later.name === name) ||
                props.context.followedBy(name),
            }}
          />
        )}
      </For>
    </div>
  );
}

function ActivityRow(props: {
  item: ExecutionActivity;
  count: number;
  turnActive: boolean;
}) {
  const status = (): ToolStatus => {
    if (props.item.status === 'failed') return 'failed';
    if (props.item.status === 'running' && props.turnActive) return 'running';
    if (props.item.status === 'completed') return 'completed';
    // Unfinished ops after the turn ends, or an unknown outcome.
    return 'completed';
  };
  const uncertain = () =>
    props.item.status === 'unknown' ||
    (props.item.status === 'running' && !props.turnActive);
  // A count replaces the card's own "Failed", so a folded run says it again.
  const outcome = () => {
    if (uncertain()) return 'Outcome unknown';
    if (props.item.status === 'failed' && props.count > 1) return 'Failed';
    return undefined;
  };
  const trailing = () => {
    const times = props.count > 1 ? `×${props.count}` : undefined;
    const said = outcome();
    if (!times) return said;
    return said ? `${times} · ${said}` : times;
  };
  return (
    <ToolCard
      title={props.item.label}
      status={status()}
      muted={uncertain()}
      trailing={trailing()}
    />
  );
}

function RecordedCall(props: {
  call: RecordedToolCall;
  context: ToolCallContext;
}) {
  const status = (): ToolStatus =>
    props.call.status === 'failed' ? 'failed' : 'completed';
  const common = (): ToolCallCommon => ({
    id: props.call.id,
    label: props.call.name,
    status: status(),
    muted: props.call.status !== 'completed',
    stopped: false,
    trailing: props.call.outputOmitted
      ? 'Result omitted'
      : props.call.status === 'unknown' || props.call.status === 'running'
        ? 'Outcome unknown'
        : undefined,
  });
  return (
    <MacroToolCall
      detail={{
        kind: 'macro',
        input: props.call.input,
        output: props.call.output,
        error: props.call.error ?? null,
      }}
      common={common()}
      context={props.context}
      grouped={false}
    />
  );
}
