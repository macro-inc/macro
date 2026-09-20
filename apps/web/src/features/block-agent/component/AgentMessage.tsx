/**
 * Renders one folded agent-session message. Pure composition: each part kind
 * has its own component under `parts/` (the chat block's handler-per-tool
 * split), user prompts get the chat block's bubble treatment, and the tail
 * thought shimmers while the turn is in flight.
 *
 * Whether the turn is in flight is the caller's to say (`state/live-turn`):
 * a message's own `stop` reads several settled turns as live, and a
 * transcript that let each message decide showed every one of them working.
 */

import { useUserId } from '@core/context/user';
import { idToDisplayName } from '@core/user/util';
import { messageSendMotion } from '@core/util/message-send-motion';
import type {
  FoldedMessage,
  MessagePart,
} from '@service-agent-fold/generated/types';
import { UserMessageBubble } from '@ui';
import { For, Index, type JSX, Show } from 'solid-js';
import { match } from 'ts-pattern';
import { isControlMessage } from '../state/control-message';
import { thoughtIsStreaming } from '../state/thought-streaming';
import { segmentParts } from '../state/tool-groups';
import {
  ActionLine,
  isToolActive,
  Thought,
  ToolGroup,
  WorkingLine,
} from '../ui';
import { AttachmentPart } from './parts/AttachmentPart';
import { ControlPart } from './parts/ControlPart';
import { ElicitationPart } from './parts/ElicitationPart';
import { PermissionPart } from './parts/PermissionPart';
import { PlanPart } from './parts/PlanPart';
import { type ToolUsePart, toolCallDetail, toolLabel } from './parts/shared';
import { TextPart } from './parts/TextPart';
import { ToolCallPart } from './parts/ToolCallPart';

/**
 * What a turn the runtime errored asks of the reader. Every such failure
 * leaves the session usable - the next message starts a fresh turn - so the
 * instruction is the same whatever the runtime said went wrong.
 */
const TURN_FAILED_LABEL =
  'An error was encountered with your session. Send another message to continue';

function AgentMessagePart(props: {
  part: MessagePart;
  message: FoldedMessage;
  /** The part's index within its message, for the tool render context. */
  index: number;
  /** The turn is still in flight — the tail thought reads "Thinking". */
  inFlight: boolean;
}): JSX.Element {
  return match(props.part)
    .with({ kind: 'text' }, (part) => (
      <TextPart text={part.text} inFlight={props.inFlight} />
    ))
    .with({ kind: 'attachment' }, (part) => <AttachmentPart part={part} />)
    .with({ kind: 'thought' }, (part) => (
      <Thought
        text={part.text}
        active={thoughtIsStreaming(
          props.inFlight,
          props.index,
          props.message.parts.length
        )}
      />
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
    .with({ kind: 'elicitation' }, (part) => (
      <ElicitationPart part={part} turn={props.message.turn} />
    ))
    .exhaustive();
}

/**
 * A run of consecutive tool calls and their accompanying thoughts (see
 * `segmentParts`), folded to one row that opens to those parts, each at
 * its original index.
 */
function ToolGroupPart(props: {
  message: FoldedMessage;
  start: number;
  /** Exclusive. */
  end: number;
  inFlight: boolean;
}): JSX.Element {
  const parts = () => props.message.parts.slice(props.start, props.end);
  const calls = () =>
    parts().filter((part): part is ToolUsePart => part.kind === 'tool_use');
  // A call the log left running in a finished turn is over (see
  // `settledToolStatus`), so a settled turn's run is never "Calling".
  const active = () =>
    props.inFlight && calls().some((call) => isToolActive(call.status));

  return (
    <Show when={calls().at(-1)}>
      {(latest) => (
        <ToolGroup
          count={calls().length}
          active={active()}
          latest={{
            label: toolLabel(latest().name),
            detail: toolCallDetail(latest()),
          }}
        >
          <For each={parts()}>
            {(part, offset) => (
              <AgentMessagePart
                part={part}
                message={props.message}
                index={props.start + offset()}
                inFlight={props.inFlight}
              />
            )}
          </For>
        </ToolGroup>
      )}
    </Show>
  );
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
 * What the working row says: the last part names the work — a tool call or
 * a plan — and a bare turn is just working.
 */
function workingLabel(message: FoldedMessage): string {
  const last = message.parts.at(-1);
  if (last === undefined) return 'Working';
  return match(last)
    .with({ kind: 'tool_use' }, () => 'Running tools')
    .with({ kind: 'plan' }, () => 'Planning')
    .otherwise(() => 'Working');
}

/**
 * The display name of whoever sent a prompt, when that is somebody other
 * than the viewer. A session is shared, so a prompt may be another
 * participant's; one's own prompts (and unattributed ones) need no byline,
 * matching the queued-prompt list in `AgentComposer`. Attribution waits
 * until the viewer id is known — `useUserId` is undefined while user-info
 * is still loading, and a missing viewer must not look like another person.
 */
function promptAuthorName(
  author: FoldedMessage['author'],
  viewerId: string | undefined
): string | undefined {
  if (
    author.kind !== 'user' ||
    author.userId === null ||
    viewerId === undefined
  )
    return undefined;
  return author.userId === viewerId
    ? undefined
    : idToDisplayName(author.userId);
}

/**
 * A prompt, in the chat block's user-bubble treatment
 * (`@core/component/AI/component/message/UserMessage.tsx`): right-aligned,
 * rounded, filled surface shared with production chat. A prompt another
 * participant sent carries their name above the bubble.
 */
function UserMessage(props: { message: FoldedMessage }) {
  const userId = useUserId();
  const authorName = () => promptAuthorName(props.message.author, userId());

  return (
    <div
      class="flex w-full flex-col items-end gap-0.5 transition-opacity"
      // Still on the wire: the fold shows the prompt before the log confirms
      // it, and the confirmation clears this in place.
      classList={{ 'opacity-60': props.message.pending }}
      aria-busy={props.message.pending || undefined}
      ref={(el) =>
        messageSendMotion(el, () =>
          props.message.requestId
            ? `agent:${props.message.agentSessionId}:${props.message.requestId}`
            : undefined
        )
      }
    >
      <Show when={authorName()}>
        {(name) => (
          <div class="text-xs text-ink-extra-muted" data-testid="prompt-author">
            {name()}
          </div>
        )}
      </Show>
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

export function Message(props: {
  message: FoldedMessage;
  /** This is the running turn's reply, by the session's one `working` truth. */
  inFlight: boolean;
}) {
  const inFlight = () => props.inFlight;
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
          {/* Segments are positional, and a run at the tail grows as calls
              stream in — so rows are keyed by index, not by segment value,
              and a group keeps its open state while it fills. */}
          <Index each={segmentParts(props.message.parts)}>
            {(segment) => (
              <Show
                when={segment().kind === 'tools'}
                fallback={
                  <Show when={props.message.parts[segment().start]}>
                    {(part) => (
                      <AgentMessagePart
                        part={part()}
                        message={props.message}
                        index={segment().start}
                        inFlight={inFlight()}
                      />
                    )}
                  </Show>
                }
              >
                <ToolGroupPart
                  message={props.message}
                  start={segment().start}
                  end={segment().end}
                  inFlight={inFlight()}
                />
              </Show>
            )}
          </Index>
          {/* The turn is open with nothing to read yet — a ripple and a label
              naming the work, so the wait reads as work rather than a stall. */}
          <Show when={inFlight() && showsWorkingLine(props.message)}>
            <WorkingLine label={workingLabel(props.message)} />
          </Show>
          {/* A turn the runtime errored is something that happened to the
              session, like a model change or a stop — so it reads as one,
              at the foot of whatever the agent managed to say first. The
              line says what to do about it; the runtime's own account of
              what happened is the detail. */}
          <Show when={failure()}>
            {(message) => (
              <ActionLine
                label={`${TURN_FAILED_LABEL} — ${message()}`}
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
