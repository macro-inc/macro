/**
 * The agent asking the user a question, or to finish a draft.
 *
 * While the fold's metadata still names this request as the one to answer,
 * it is the ask card the same request is in a channel (`InteractionCard`):
 * the question as its title, or the draft in the composer it goes out
 * from. A `pending` part on a turn that has ended, or on a dead connection,
 * reads as "not answered" rather than offering what the agent is no longer
 * waiting on. Resolved parts read back what was chosen.
 *
 * Editors can answer; everyone else sees the same card with nothing to
 * press, and who can.
 */

import { InteractionCard } from '@app/features/agent-interactions/components/InteractionCard';
import type { AgentInteraction } from '@app/features/agent-interactions/context/interaction';
import type {
  AnsweredField,
  AnsweredValue,
  MessagePart,
} from '@service-agent-fold/generated/types';
import { For, Show } from 'solid-js';
import { match } from 'ts-pattern';
import { useAgentSession } from '../../context/AgentSessionContext';
import { ToolCard } from '../../ui';
import { UserToolCall } from './UserToolCall';

type ElicitationPartData = Extract<MessagePart, { kind: 'elicitation' }>;

function outcomeLabel(part: ElicitationPartData): string {
  return match(part.outcome)
    .with({ kind: 'pending' }, () => 'Not answered')
    .with({ kind: 'accepted' }, () =>
      match(part.request.kind)
        .with('url', () => 'Opened')
        .with('user_tool', () => 'Confirmed')
        .otherwise(() => 'Answered')
    )
    .with({ kind: 'declined' }, () => 'Declined')
    .with({ kind: 'cancelled' }, () => 'Cancelled')
    .with({ kind: 'completed' }, () => 'Finished')
    .with({ kind: 'errored' }, () => 'Refused')
    .with({ kind: 'unrecognized' }, () => 'Answered')
    .exhaustive();
}

export function ElicitationPart(props: {
  part: ElicitationPartData;
  turn: number;
}) {
  const { interactions } = useAgentSession();
  // Live only while the metadata slot names this exact request. Each event
  // brings the request anew; the card stays mounted, and keeps whatever was
  // typed into it with the controller.
  const live = () =>
    props.part.outcome.kind === 'pending'
      ? interactions
          .pending()
          .find(
            (request): request is AgentInteraction =>
              request.kind === 'elicitation' &&
              request.requestId === props.part.requestId &&
              request.turn === props.turn
          )
      : undefined;

  return (
    <Show when={live()} fallback={<ResolvedElicitation part={props.part} />}>
      {(request) => (
        <InteractionCard request={request()} controller={interactions} />
      )}
    </Show>
  );
}

function ResolvedElicitation(props: { part: ElicitationPartData }) {
  // A reviewed user tool that has reported back reads as the tool: the draft
  // it ran with and what it did - the same card the chat block's user tools
  // settle into.
  const reviewedTool = () => {
    const { request, toolOutcome } = props.part;
    return request.kind === 'user_tool' && toolOutcome
      ? { request, toolOutcome }
      : undefined;
  };
  return (
    <Show
      when={reviewedTool()}
      fallback={<ResolvedQuestion part={props.part} />}
    >
      {(reviewed) => (
        <UserToolCall
          detail={{
            kind: 'user_tool',
            input: reviewed().request.draft,
            outcome: reviewed().toolOutcome,
          }}
          common={{
            id: props.part.toolCall ?? String(props.part.requestId),
            label: reviewed().request.tool,
            status:
              reviewed().toolOutcome.kind === 'failed' ? 'failed' : 'completed',
            muted: reviewed().toolOutcome.kind === 'failed',
            trailing: undefined,
          }}
          // The tool has reported back, so nothing is still going out.
          inFlight={false}
        />
      )}
    </Show>
  );
}

/** One answer as a line of text. The fold has already resolved the values. */
function answerText(value: AnsweredValue): string {
  return match(value)
    .with(
      { kind: 'text' },
      { kind: 'custom' },
      { kind: 'number' },
      (v) => v.text
    )
    .with({ kind: 'boolean' }, (v) => (v.checked ? 'Yes' : 'No'))
    .with({ kind: 'choice' }, (v) => v.choice.title ?? v.choice.value)
    .with({ kind: 'choices' }, (v) =>
      v.choices.map((choice) => choice.title ?? choice.value).join(', ')
    )
    .with({ kind: 'unrecognized' }, () => '')
    .exhaustive();
}

function ResolvedQuestion(props: { part: ElicitationPartData }) {
  const refusal = () =>
    props.part.outcome.kind === 'errored'
      ? props.part.outcome.message
      : undefined;
  // The harness's own reading outranks what we sent: it is what the agent
  // actually acted on. Both arrive from the fold in the same shape.
  const shown = (): AnsweredField[] =>
    (
      props.part.reported ??
      (props.part.outcome.kind === 'accepted' ? props.part.outcome.answers : [])
    ).filter((answer) => answer.value.kind !== 'unrecognized');

  return (
    <ToolCard
      title="Question"
      subtitle={props.part.message}
      status={props.part.outcome.kind === 'errored' ? 'failed' : 'completed'}
      muted={props.part.outcome.kind === 'errored'}
      trailing={<span class="text-ink">{outcomeLabel(props.part)}</span>}
      hasContent={shown().length > 0 || Boolean(refusal())}
    >
      <Show when={shown().length > 0 || refusal()}>
        <div class="flex flex-col gap-2 py-1">
          <For each={shown()}>
            {(answer) => (
              <div class="flex min-w-0 flex-col gap-0.5">
                <div class="text-xs text-ink-muted">{answer.label}</div>
                <div class="text-sm text-ink wrap-break-word">
                  {answerText(answer.value)}
                </div>
              </div>
            )}
          </For>
          <Show when={refusal()}>
            {(message) => <div class="text-xs text-failure">{message()}</div>}
          </Show>
        </div>
      </Show>
    </ToolCard>
  );
}
