/**
 * Renders one folded agent-session message. Pure composition: each part kind
 * has its own component under `parts/` (the chat block's handler-per-tool
 * split), user prompts get the chat block's bubble treatment, and thoughts
 * shimmer while the turn is in flight.
 */

import { Collapsible } from '@kobalte/core/collapsible';
import CaretRight from '@phosphor/caret-right.svg';
import type {
  FoldedMessage,
  MessagePart,
} from '@service-agent-fold/generated/types';
import { createMemo, For, type JSX, Show } from 'solid-js';
import { match } from 'ts-pattern';
import { isControlMessage } from '../state/control-message';
import { ActionLine, Thought } from '../ui';
import { ControlPart } from './parts/ControlPart';
import { ElicitationPart } from './parts/ElicitationPart';
import { PermissionPart } from './parts/PermissionPart';
import { PlanPart } from './parts/PlanPart';
import { TextPart } from './parts/TextPart';
import { ToolCallPart } from './parts/ToolCallPart';

function AgentMessagePart(props: {
  part: MessagePart;
  message: FoldedMessage;
  /** The part's index within its message, for the tool render context. */
  index: number;
  /** The turn is still in flight — thoughts read "Thinking" and shimmer. */
  inFlight: boolean;
}): JSX.Element {
  return match(props.part)
    .with({ kind: 'text' }, (part) => (
      <TextPart text={part.text} inFlight={props.inFlight} />
    ))
    .with({ kind: 'thought' }, (part) => (
      <Thought text={part.text} active={props.inFlight} />
    ))
    .with({ kind: 'tool_use' }, (part) => (
      <ToolCallPart
        part={part}
        context={{
          sessionId: props.message.agentSessionId,
          // The turn and side identify a message within its session (see
          // `@core/agent-fold/message-id.ts`), so they make its stable id.
          messageId: `${props.message.agentSessionId}:${props.message.turn}:${props.message.author.kind}`,
          partIndex: props.index,
          inFlight: props.inFlight,
        }}
      />
    ))
    .with({ kind: 'permission' }, (part) => <PermissionPart part={part} />)
    .with({ kind: 'plan' }, (part) => <PlanPart part={part} />)
    .with({ kind: 'control' }, (part) => <ControlPart part={part} />)
    .with({ kind: 'elicitation' }, (part) => <ElicitationPart part={part} />)
    .exhaustive();
}

/**
 * A prompt, in the chat block's user-bubble treatment
 * (`@core/component/AI/component/message/UserMessage.tsx`): right-aligned,
 * rounded gray surface with a hairline border.
 */
function UserMessage(props: { message: FoldedMessage }) {
  return (
    <div class="flex w-full">
      {/* Phone: a full-width card. Desktop: hugs the text, right-aligned. */}
      <div class="relative w-full overflow-hidden rounded-2xl border border-edge-muted bg-ink/5 px-4 py-3 text-ink md:ml-auto md:w-auto md:max-w-[calc(100%-8rem)]">
        <For each={props.message.parts}>
          {(part, index) => (
            <AgentMessagePart
              part={part}
              message={props.message}
              index={index()}
              inFlight={false}
            />
          )}
        </For>
      </div>
    </div>
  );
}

function isActivity(part: MessagePart) {
  return (
    part.kind === 'thought' ||
    (part.kind === 'tool_use' && part.detail.kind !== 'user_tool')
  );
}

export function Message(props: { message: FoldedMessage }) {
  // Stable numeric keys keep disclosures open as streamed parts update.
  const starts = createMemo(() =>
    props.message.parts.flatMap((part, index, parts) =>
      index > 0 && isActivity(part) && isActivity(parts[index - 1])
        ? []
        : [index]
    )
  );
  const run = (start: number) => {
    const indices = [start];
    if (isActivity(props.message.parts[start])) {
      for (
        let i = start + 1;
        i < props.message.parts.length && isActivity(props.message.parts[i]);
        i++
      )
        indices.push(i);
    }
    return indices;
  };
  const inFlight = () =>
    props.message.author.kind === 'agent' && props.message.stop == null;
  const failure = () =>
    props.message.stop?.kind === 'failed'
      ? props.message.stop.message
      : undefined;

  return (
    <Show
      when={
        props.message.author.kind === 'user' && !isControlMessage(props.message)
      }
      fallback={
        <div class="flex flex-col gap-5 min-w-0">
          <For each={starts()}>
            {(start) => {
              const indices = () => run(start);
              const tools = () =>
                indices().filter(
                  (index) => props.message.parts[index].kind === 'tool_use'
                ).length;
              const parts = () => (
                <For each={indices()}>
                  {(index) => (
                    <AgentMessagePart
                      part={props.message.parts[index]}
                      message={props.message}
                      index={index}
                      inFlight={inFlight()}
                    />
                  )}
                </For>
              );
              return (
                <Show
                  when={isActivity(props.message.parts[start]) && tools() > 1}
                  fallback={parts()}
                >
                  <Collapsible
                    defaultOpen
                    class="my-1 min-w-0 border-b border-edge-muted pb-3"
                  >
                    <Collapsible.Trigger class="group flex min-h-8 items-center gap-1.5 rounded-md px-1 text-xs text-ink-muted hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50">
                      <CaretRight class="size-3 shrink-0 transition-transform duration-150 group-data-expanded:rotate-90 motion-reduce:transition-none" />
                      {tools()} tool calls
                    </Collapsible.Trigger>
                    <Collapsible.Content class="data-closed:hidden">
                      <div class="flex min-w-0 flex-col gap-1">{parts()}</div>
                    </Collapsible.Content>
                  </Collapsible>
                </Show>
              );
            }}
          </For>
          {/* A turn the runtime errored is something that happened to the
              session, like a model change or a stop — so it reads as one,
              at the foot of whatever the agent managed to say first. */}
          <Show when={failure()}>
            {(message) => (
              <ActionLine
                label={`The agent couldn't answer — ${message()}`}
                detail={message()}
                failed
              />
            )}
          </Show>
        </div>
      }
    >
      <UserMessage message={props.message} />
    </Show>
  );
}
