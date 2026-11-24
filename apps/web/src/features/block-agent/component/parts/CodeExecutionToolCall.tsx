import type {
  ExecutionActivity,
  ExecutionRecord,
  RecordedToolCall,
} from '@service-agent-harness/generated/schemas';
import { For, Show } from 'solid-js';
import { isToolActive, ToolCard, type ToolStatus } from '../../ui';
import { MacroToolCall } from './MacroToolCall';
import type { ToolCallCommon, ToolCallContext } from './shared';

/**
 * A program's steps, as rows of the tool group it belongs to: each observed
 * operation and historical calls with their registered Macro result
 * components. The program itself is never shown, so one that ended without a
 * step shows nothing: the agent explains a failure in its reply.
 */
export function CodeExecutionToolCall(props: {
  common: ToolCallCommon;
  context: ToolCallContext;
  record?: ExecutionRecord;
  loading: boolean;
  unavailable: boolean;
}) {
  const calls = () => props.record?.calls ?? [];
  const activity = () => props.record?.activity ?? [];

  return (
    <div
      class="flex min-w-0 flex-col"
      data-code-execution={props.record?.executionId}
    >
      <For each={activity()}>
        {(item) => (
          <div class="min-h-8 shrink-0">
            <ActivityRow
              item={item}
              turnActive={isToolActive(props.common.status)}
            />
          </div>
        )}
      </For>
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

function ActivityRow(props: { item: ExecutionActivity; turnActive: boolean }) {
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
  return (
    <ToolCard
      title={props.item.label}
      status={status()}
      muted={uncertain()}
      trailing={uncertain() ? 'Outcome unknown' : undefined}
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
    unsuccessful: props.call.status !== 'completed',
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
