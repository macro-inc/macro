/**
 * Renders one folded agent-session message. Pure composition: each part kind
 * has its own component under `parts/` (the chat block's handler-per-tool
 * split), user prompts get the chat block's bubble treatment, and thoughts
 * shimmer while the turn is in flight.
 */

import type {
  FoldedMessage,
  MessagePart,
} from '@service-agent-fold/generated/types';
import { For, type JSX, Show } from 'solid-js';
import { match } from 'ts-pattern';
import { isControlMessage } from '../state/control-message';
import { ActionLine, Thought } from '../ui';
import { ControlPart } from './parts/ControlPart';
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
    .with({ kind: 'text' }, (part) => <TextPart text={part.text} />)
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
      <div class="relative ml-auto max-w-[calc(100%-8rem)] overflow-hidden rounded-lg border border-edge-muted bg-hover px-3 py-2 text-ink">
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
