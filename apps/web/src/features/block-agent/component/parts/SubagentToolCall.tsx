/**
 * Work the agent delegated to another agent: the brief, whatever of the
 * subagent's own activity the harness attributed to it (nested through the
 * same part components), and what it reported back.
 */

import type {
  MessagePart,
  SubagentResult,
  ToolDetail,
} from '@service-agent-fold/generated/types';
import { For, type JSX, Show } from 'solid-js';
import { match } from 'ts-pattern';
import { FoldedOutput, Thought, ToolCard } from '../../ui';
import type { ToolCallCommon, ToolCallContext } from './shared';
import { TextPart } from './TextPart';
import { ToolCallPart } from './ToolCallPart';

type SubagentDetail = Extract<ToolDetail, { kind: 'subagent' }>;

/** `1 tool · 3.5s · 26k tokens`, from whatever the harness reported. */
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
  if (result.tokens != null) {
    facts.push(
      result.tokens >= 1000
        ? `${Math.round(result.tokens / 1000)}k tokens`
        : `${result.tokens} tokens`
    );
  }
  return facts.length > 0 ? facts.join(' · ') : undefined;
}

/**
 * A title for a call whose harness gave no description: the brief's first
 * line, cut to fit a row. Macro's own `Subagent` tool and OpenCode's `task`
 * carry a prompt and nothing else, and a card that only says "Subagent"
 * tells the reader nothing about what was delegated.
 */
export function promptTitle(
  prompt: string,
  maxLength = 72
): string | undefined {
  const line = prompt
    .split('\n')
    .map((line) => line.trim())
    .find((line) => line.length > 0);
  if (line == null) return undefined;
  if (line.length <= maxLength) return line;
  const cut = line.slice(0, maxLength);
  const lastSpace = cut.lastIndexOf(' ');
  return `${lastSpace > maxLength / 2 ? cut.slice(0, lastSpace) : cut}…`;
}

/** A subagent's nested part: prose, reasoning, or one of its tool calls. */
function ChildPart(props: {
  part: MessagePart;
  index: number;
  context?: ToolCallContext;
}) {
  const inFlight = () => props.context?.inFlight ?? false;
  return (
    match(props.part)
      .with({ kind: 'text' }, (part) => <TextPart text={part.text} />)
      .with({ kind: 'thought' }, (part) => (
        <Thought text={part.text} active={inFlight()} />
      ))
      .with({ kind: 'tool_use' }, (part) => (
        <ToolCallPart
          part={part}
          context={
            props.context && {
              ...props.context,
              // A child's slot is its own; the parent's index is not it.
              partIndex: props.index,
            }
          }
        />
      ))
      // A subagent's permission, plan, or control has nowhere to nest today;
      // the harnesses that attribute children only attribute tool calls.
      .otherwise(() => null)
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
  // Description, else the brief's first line, else the tool's name. When the
  // brief stands in for the title, the tool's name moves to the subtitle so
  // the row still says which harness's delegation this is.
  const fromPrompt = () =>
    props.detail.description == null && props.detail.prompt != null
      ? promptTitle(props.detail.prompt)
      : undefined;
  const title = () =>
    props.detail.description ?? fromPrompt() ?? props.common.label;
  const subtitle = () =>
    [
      fromPrompt() != null ? props.common.label : undefined,
      props.detail.agentType,
      props.detail.background ? 'background' : undefined,
    ]
      .filter(Boolean)
      .join(' · ') || undefined;
  const trailing = () =>
    props.common.trailing ??
    (props.detail.result?.error != null ? (
      <span class="text-ink">Failed</span>
    ) : props.detail.result ? (
      <Show when={resultSummary(props.detail.result)}>
        {(summary) => <span>{summary()}</span>}
      </Show>
    ) : undefined);
  const hasBody = () =>
    props.detail.prompt != null ||
    props.detail.children.length > 0 ||
    props.detail.result != null;

  return (
    <ToolCard
      title={title()}
      subtitle={subtitle()}
      status={props.common.status}
      muted={props.common.muted || props.detail.result?.error != null}
      trailing={trailing()}
      defaultOpen={props.detail.children.length > 0}
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
              <For each={props.detail.children}>
                {(child, index) => (
                  <ChildPart
                    part={child}
                    index={index()}
                    context={childContext()}
                  />
                )}
              </For>
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
                    <span class="text-xs text-ink-extra-muted">{model()}</span>
                  )}
                </Show>
              </div>
            )}
          </Show>
        </div>
      </Show>
    </ToolCard>
  );
}
