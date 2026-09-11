/**
 * Renders one folded agent-session message. Pure composition: each part kind
 * has its own component under `parts/` (the chat block's handler-per-tool
 * split), user prompts get the chat block's bubble treatment, and thoughts
 * shimmer while the turn is in flight.
 */

import { messageSendMotion } from '@core/util/message-send-motion';
import type {
  FoldedMessage,
  MessagePart,
} from '@service-agent-fold/generated/types';
import { UserMessageBubble } from '@ui';
import { For, type JSX, Show } from 'solid-js';
import { match } from 'ts-pattern';
import { isControlMessage } from '../state/control-message';
import { ActionLine, Thought, WorkingLine } from '../ui';
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
 * Whether an open turn should show the working row at its tail.
 *
 * Skipped wherever the transcript already shows the turn is alive — prose
 * streaming in, a thought shimmering — and wherever it is not: a permission
 * or elicitation prompt is waiting on the reader, not working.
 */
function showsWorkingLine(message: FoldedMessage): boolean {
  const last = message.parts[message.parts.length - 1];
  if (last === undefined) return true;
  return match(last)
    .with(
      { kind: 'text' },
      { kind: 'thought' },
      { kind: 'permission' },
      { kind: 'elicitation' },
      () => false
    )
    .otherwise(() => true);
}

/**
 * A prompt, in the chat block's user-bubble treatment
 * (`@core/component/AI/component/message/UserMessage.tsx`): right-aligned,
 * rounded, filled surface shared with production chat.
 */
function UserMessage(props: { message: FoldedMessage }) {
  return (
    <div
      class="flex w-full"
      ref={(el) =>
        messageSendMotion(el, () =>
          props.message.requestId
            ? `agent:${props.message.agentSessionId}:${props.message.requestId}`
            : undefined
        )
      }
    >
      <UserMessageBubble>
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
      </UserMessageBubble>
    </div>
  );
}

export function Message(props: { message: FoldedMessage }) {
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
        <div class="flex flex-col gap-1 min-w-0">
          <For each={props.message.parts}>
            {(part, index) => (
              <AgentMessagePart
                part={part}
                message={props.message}
                index={index()}
                inFlight={inFlight()}
              />
            )}
          </For>
          {/* The turn is open with nothing to read yet — a dot and a rotating
              verb, so the wait reads as work rather than as a stall. */}
          <Show when={inFlight() && showsWorkingLine(props.message)}>
            <WorkingLine />
          </Show>
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
