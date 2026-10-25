import CodeIcon from '@phosphor/code.svg';
import type {
  ExecutionActivity,
  ExecutionRecord,
  RecordedToolCall,
} from '@service-agent-harness/generated/schemas';
import { For, Show } from 'solid-js';
import { isToolActive, ToolCard, type ToolStatus } from '../../ui';
import { LiveToolGroup } from '../../views/LiveToolGroup';
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
  const activity = () => props.record?.activity ?? [];
  const errorVisible = () =>
    Boolean(
      props.error &&
        (props.record?.status !== 'running' ||
          !isToolActive(props.common.status))
    );
  const activeIndex = () =>
    isToolActive(props.common.status)
      ? activity().findIndex((item) => item.status === 'running')
      : -1;
  const active = () => activeIndex() !== -1;

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
      <Show when={activity().length > 0}>
        <LiveToolGroup
          count={activity().length}
          active={active()}
          activeIndex={active() ? activeIndex() : undefined}
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
        </LiveToolGroup>
      </Show>
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
    muted: props.call.status !== 'completed',
    stopped: false,
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
