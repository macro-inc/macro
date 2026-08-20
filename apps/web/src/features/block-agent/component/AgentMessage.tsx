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
import { Thought } from '../ui';
import { ControlPart } from './parts/ControlPart';
import { PermissionPart } from './parts/PermissionPart';
import { PlanPart } from './parts/PlanPart';
import { TextPart } from './parts/TextPart';
import { ToolCallPart } from './parts/ToolCallPart';

function AgentMessagePart(props: {
  part: MessagePart;
  /** The turn is still in flight — thoughts read "Thinking" and shimmer. */
  inFlight: boolean;
}): JSX.Element {
  return match(props.part)
    .with({ kind: 'text' }, (part) => <TextPart text={part.text} />)
    .with({ kind: 'thought' }, (part) => (
      <Thought text={part.text} active={props.inFlight} />
    ))
    .with({ kind: 'tool_use' }, (part) => <ToolCallPart part={part} />)
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
          {(part) => <AgentMessagePart part={part} inFlight={false} />}
        </For>
      </div>
    </div>
  );
}

export function Message(props: { message: FoldedMessage }) {
  const inFlight = () =>
    props.message.author.kind === 'agent' && props.message.stop == null;

  return (
    <Show
      when={props.message.author.kind === 'user'}
      fallback={
        <div class="flex flex-col gap-1 min-w-0">
          <For each={props.message.parts}>
            {(part) => <AgentMessagePart part={part} inFlight={inFlight()} />}
          </For>
        </div>
      }
    >
      <UserMessage message={props.message} />
    </Show>
  );
}
