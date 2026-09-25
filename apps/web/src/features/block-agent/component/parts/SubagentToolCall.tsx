/**
 * Work the agent delegated to another agent: the brief, whatever of the
 * subagent's own activity the harness attributed to it (nested through the
 * same part components), and what it reported back.
 */

import { modelLabel } from '@core/component/AI/constant/model-label';
import AgentIcon from '@phosphor/sparkle.svg';
import type {
  MessagePart,
  SubagentResult,
  ToolDetail,
} from '@service-agent-fold/generated/types';
import { Index, type JSX, Match, Show, Switch } from 'solid-js';
import { thoughtIsStreaming } from '../../state/thought-streaming';
import { FoldedOutput, Thought, ToolCard } from '../../ui';
import type { ToolCallCommon, ToolCallContext } from './shared';
import { TextPart } from './TextPart';
import { ToolCallPart } from './ToolCallPart';

type SubagentDetail = Extract<ToolDetail, { kind: 'subagent' }>;

/** `1 tool · 3.5s`, from whatever the harness reported. */
function resultSummary(result: SubagentResult): string | undefined {
  const facts: string[] = [];
  if (result.toolUses != null) {
    facts.push(result.toolUses === 1 ? '1 tool' : `${result.toolUses} tools`);
  }
  if (result.durationMs != null) {
    facts.push(
      result.durationMs >= 1000
        ? `${(result.durationMs / 1000).toFixed(1)}s`
        : `${result.durationMs}ms`
    );
  }
  return facts.length > 0 ? facts.join(' · ') : undefined;
}

/** A subagent's nested part: prose, reasoning, or one of its tool calls. */
function ChildPart(props: {
  part: MessagePart;
  index: number;
  childCount: number;
  context?: ToolCallContext;
}) {
  const inFlight = () => props.context?.inFlight ?? false;
  return (
    <Switch>
      <Match when={props.part.kind === 'text' && props.part}>
        {(part) => <TextPart text={part().text} />}
      </Match>
      <Match when={props.part.kind === 'thought' && props.part}>
        {(part) => (
          <Thought
            text={part().text}
            active={thoughtIsStreaming(
              inFlight(),
              props.index,
              props.childCount
            )}
          />
        )}
      </Match>
      <Match when={props.part.kind === 'tool_use' && props.part}>
        {(part) => (
          <ToolCallPart
            part={part()}
            context={
              props.context && {
                ...props.context,
                // A child's slot is its own; the parent's index is not it.
                partIndex: props.index,
              }
            }
          />
        )}
      </Match>
    </Switch>
  );
}

export function SubagentToolCall(props: {
  detail: SubagentDetail;
  common: ToolCallCommon;
  context?: ToolCallContext;
}): JSX.Element {
  const working = () =>
    props.common.status === 'pending' || props.common.status === 'running';
  // Children only shimmer while both the subagent and the turn are live.
  const childContext = () =>
    props.context && {
      ...props.context,
      inFlight: working() && props.context.inFlight,
    };
  const subtitle = () =>
    [
      props.detail.agentType ?? 'subagent',
      props.detail.background ? 'background' : undefined,
    ]
      .filter(Boolean)
      .join(' · ') || undefined;
  const trailing = () =>
    props.common.trailing ??
    (props.detail.result?.error != null ? (
      <span class="text-ink">Failed</span>
    ) : props.detail.result ? (
      resultSummary(props.detail.result)
    ) : undefined);
  const hasBody = () =>
    props.detail.prompt != null ||
    props.detail.children.length > 0 ||
    props.detail.result != null;

  return (
    <ToolCard
      icon={<AgentIcon class="size-4" />}
      title={props.detail.title}
      subtitle={subtitle()}
      status={props.common.status}
      muted={props.common.muted || props.detail.result?.error != null}
      trailing={trailing()}
      hasContent={hasBody()}
    >
      <Show when={hasBody()}>
        <div class="flex flex-col gap-2">
          <Show when={props.detail.prompt}>
            {(prompt) => (
              <blockquote class="border-l-2 border-edge-muted pl-2 text-xs text-ink-muted whitespace-pre-wrap wrap-break-word">
                {prompt()}
              </blockquote>
            )}
          </Show>
          <Show when={props.detail.children.length > 0}>
            <div class="flex flex-col gap-1 border-l-2 border-edge-muted pl-2">
              <Index each={props.detail.children}>
                {(child, index) => (
                  <ChildPart
                    part={child()}
                    index={index}
                    childCount={props.detail.children.length}
                    context={childContext()}
                  />
                )}
              </Index>
            </div>
          </Show>
          <Show when={props.detail.result}>
            {(result) => (
              <div class="flex flex-col gap-1">
                <Show when={result().error}>
                  {(error) => <FoldedOutput text={error()} />}
                </Show>
                <Show when={result().text}>
                  {(text) => <TextPart text={text()} />}
                </Show>
                <Show when={result().model}>
                  {(model) => (
                    <span class="text-xs text-ink-extra-muted">
                      {modelLabel(model())}
                    </span>
                  )}
                </Show>
                <Show when={result().tokens != null}>
                  <span class="text-xs text-ink-extra-muted">
                    {result().tokens?.toLocaleString()} tokens
                  </span>
                </Show>
              </div>
            )}
          </Show>
        </div>
      </Show>
    </ToolCard>
  );
}
