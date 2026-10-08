import CodeIcon from '@phosphor/code.svg';
import type {
  ExecutionRecord,
  RecordedToolCall,
} from '@service-agent-harness/generated/schemas';
import { For, Show } from 'solid-js';
import { ToolCard, type ToolStatus } from '../../ui';
import { DisplayResultsToolCall } from './DisplayResultsToolCall';
import { MacroToolCall } from './MacroToolCall';
import type { ToolCallCommon, ToolCallContext } from './shared';

/** Observed inner calls keep their registered Macro result components. */
export function CodeExecutionToolCall(props: {
  common: ToolCallCommon;
  context: ToolCallContext;
  record?: ExecutionRecord;
  source?: string;
  error?: string | null;
  loading: boolean;
  unavailable: boolean;
}) {
  const calls = () => props.record?.calls ?? [];
  return (
    <div class="min-w-0" data-code-execution={props.record?.executionId}>
      <ToolCard
        title="Run code"
        icon={<CodeIcon />}
        status={props.common.status}
        muted={props.common.muted}
        trailing={
          props.common.trailing ??
          (props.record ? `${calls().length} tool calls` : undefined)
        }
        hasContent={Boolean(props.source || props.record || props.error)}
      >
        <Show when={props.source}>
          <pre class="max-h-64 overflow-auto whitespace-pre-wrap break-words font-mono">
            {props.source}
          </pre>
        </Show>
        <Show
          when={
            props.record?.result !== undefined && props.record?.result !== null
          }
        >
          <pre class="mt-2 max-h-64 overflow-auto whitespace-pre-wrap break-words font-mono">
            {JSON.stringify(props.record?.result, null, 2)}
          </pre>
        </Show>
        <Show when={props.error}>
          <p class="mt-2 text-ink-muted">{props.error}</p>
        </Show>
      </ToolCard>
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
