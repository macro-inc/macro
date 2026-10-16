import CodeIcon from '@phosphor/code.svg';
import type {
  ExecutionRecord,
  RecordedToolCall,
} from '@service-agent-harness/generated/schemas';
import { createMemo, For, Show } from 'solid-js';
import { isToolActive, ToolCard, type ToolStatus } from '../../ui';
import { DisplayResultsToolCall } from './DisplayResultsToolCall';
import { MacroToolCall } from './MacroToolCall';
import type { ToolCallCommon, ToolCallContext } from './shared';

/** Observed inner calls keep their registered Macro result components. */
export function CodeExecutionToolCall(props: {
  common: ToolCallCommon;
  context: ToolCallContext;
  record?: ExecutionRecord;
  error?: string | null;
  loading: boolean;
  unavailable: boolean;
}) {
  const calls = () => props.record?.calls ?? [];
  const errorVisible = () =>
    Boolean(
      props.error &&
        (props.record?.status !== 'running' ||
          !isToolActive(props.common.status))
    );
  const activity = createMemo(() => {
    const groups = new Map<
      string,
      {
        label: string;
        completed: number;
        running: number;
        failed: number;
        unknown: number;
      }
    >();
    for (const item of props.record?.activity ?? []) {
      const group = groups.get(item.label) ?? {
        label: item.label,
        completed: 0,
        running: 0,
        failed: 0,
        unknown: 0,
      };
      const status =
        item.status === 'running' && !isToolActive(props.common.status)
          ? 'unknown'
          : item.status;
      group[status] += 1;
      groups.set(item.label, group);
    }
    return [...groups.values()];
  });
  return (
    <div class="min-w-0" data-code-execution={props.record?.executionId}>
      <Show when={activity().length === 0 || errorVisible()}>
        <ToolCard
          title="Workspace activity"
          icon={<CodeIcon />}
          status={props.common.status}
          muted={props.common.muted}
          trailing={
            props.common.trailing ??
            (calls().length > 0
              ? `${calls().length} tool calls`
              : isToolActive(props.common.status)
                ? 'Working in your workspace…'
                : undefined)
          }
          hasContent={errorVisible()}
        >
          <Show when={errorVisible()}>
            <p class="mt-2 text-ink-muted">{props.error}</p>
          </Show>
        </ToolCard>
      </Show>
      <For each={activity()}>
        {(group) => (
          <ToolCard
            title={group.label}
            status={
              group.running > 0
                ? 'running'
                : group.failed > 0
                  ? 'failed'
                  : 'completed'
            }
            trailing={[
              group.completed && `${group.completed} completed`,
              group.running && `${group.running} running`,
              group.failed && `${group.failed} failed`,
              group.unknown && `${group.unknown} outcome unknown`,
            ]
              .filter(Boolean)
              .join(' · ')}
          />
        )}
      </For>
      <Show when={props.record?.activityTruncated}>
        <p class="text-xs text-ink-extra-muted">
          Activity list limited to the first 128 requests.
        </p>
      </Show>
      <Show
        when={
          !props.record && !props.error && props.common.status !== 'completed'
        }
      >
        <p class="text-xs text-ink-extra-muted">Working in your workspace…</p>
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
    trailing: props.call.outputOmitted
      ? 'Result omitted'
      : props.call.status === 'unknown' || props.call.status === 'running'
        ? 'Outcome unknown'
        : undefined,
  });
  return (
    <Show
      when={
        props.call.name === 'DisplayResults' &&
        props.call.status === 'completed'
      }
      fallback={
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
      }
    >
      <DisplayResultsToolCall
        input={props.call.input}
        error={props.call.error}
        common={common()}
      />
    </Show>
  );
}
