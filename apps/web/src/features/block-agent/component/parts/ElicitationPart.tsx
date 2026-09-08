/**
 * The agent asking the user a question.
 *
 * Interactive only while the fold's metadata still names this question as the
 * one to answer: a `pending` part on a turn that has ended, or on a dead
 * connection, reads as "not answered" rather than offering a form the agent
 * is no longer waiting on. Resolved parts read back what was chosen.
 *
 * Only the session's owner can answer (the service refuses anyone else), so
 * another viewer sees the same live card with its controls disabled and the
 * owner named as the one it waits on.
 *
 * The form, URL consent, and unrecognized-request controls are the
 * `LiveElicitation` ones the channel's Magic Chip shares; a Macro user tool
 * under review opens the tool's own composer here.
 */

import { CalendarDraftComposer } from '@core/component/AI/component/tool/calendar/DraftComposer';
import { EmailDraftComposer } from '@core/component/AI/component/tool/email/DraftComposer';
import type {
  AnsweredField,
  AnsweredValue,
  MessagePart,
} from '@service-agent-fold/generated/types';
import { deserializeToolCall } from '@service-cognition/generated/tools/tool';
import type {
  CreateCalendarEvent,
  SendEmail,
} from '@service-cognition/generated/tools/types';
import { Button } from '@ui';
import { createMemo, For, Match, Show, Switch } from 'solid-js';
import { match, P } from 'ts-pattern';
import { useAgentSession } from '../../context/AgentSessionContext';
import { createElicitationReviewSink } from '../../state/elicitation-review-sink';
import { ToolCard } from '../../ui';
import { LiveQuestionCard, type RespondToElicitation } from './LiveElicitation';
import { UserToolCall } from './UserToolCall';

type ElicitationPartData = Extract<MessagePart, { kind: 'elicitation' }>;
type UserToolRequest = Extract<
  ElicitationPartData['request'],
  { kind: 'user_tool' }
>;

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

export function ElicitationPart(props: { part: ElicitationPartData }) {
  const { elicitation, bot } = useAgentSession();

  // Live only while the metadata slot names this exact request.
  const live = () =>
    props.part.outcome.kind === 'pending' &&
    elicitation.pending()?.requestId === props.part.requestId;

  const agentName = () => bot()?.name ?? 'The agent';
  // Controls are inert while an answer is on the wire and for anyone who is
  // not the owner.
  const locked = () => elicitation.answering() || !elicitation.canAnswer();
  const waitingFor = () =>
    elicitation.canAnswer()
      ? 'Waiting for you'
      : `Waiting for ${elicitation.ownerName()}`;

  return (
    <Show when={live()} fallback={<ResolvedElicitation part={props.part} />}>
      <ToolCard
        title={`${agentName()} is asking`}
        status="running"
        defaultOpen
        trailing={<span class="text-ink-muted">{waitingFor()}</span>}
      >
        <div class="flex flex-col gap-3 py-1">
          <div class="text-sm text-ink">{props.part.message}</div>
          <Show when={!elicitation.canAnswer()}>
            <div class="text-xs text-ink-extra-muted">
              Only {elicitation.ownerName()} can answer this.
            </div>
          </Show>
          {match(props.part.request)
            .with({ kind: 'user_tool' }, (request) => (
              <LiveUserTool
                request={request}
                toolCall={props.part.toolCall ?? String(props.part.requestId)}
                locked={locked()}
                onRespond={elicitation.respond}
              />
            ))
            .with(
              { kind: P.union('form', 'url', 'unrecognized') },
              (request) => (
                <LiveQuestionCard
                  request={request}
                  locked={locked()}
                  onRespond={elicitation.respond}
                />
              )
            )
            .exhaustive()}
        </div>
      </ToolCard>
    </Show>
  );
}

/**
 * A Macro user tool under review, in the tool's own composer: the calendar
 * event form for `CreateCalendarEvent`, the email compose for `SendEmail`.
 * The composer's Create/Send accepts the review with the whole edited draft;
 * Cancel declines it. A draft the tool's schema rejects, or a tool with no
 * composer here, falls back to the flat form the agent also sent.
 */
function LiveUserTool(props: {
  request: UserToolRequest;
  toolCall: string;
  locked: boolean;
  onRespond: RespondToElicitation;
}) {
  const { elicitation } = useAgentSession();
  const typed = createMemo(() => {
    const call = deserializeToolCall({
      id: props.toolCall,
      name: props.request.tool,
      json: props.request.draft,
    });
    return call.isOk() ? call.value : undefined;
  });
  const sink = <T,>() =>
    createElicitationReviewSink<T>({
      canAnswer: elicitation.canAnswer,
      ownerName: elicitation.ownerName,
      answering: elicitation.answering,
      respond: props.onRespond,
    });

  return (
    <Switch
      fallback={
        <LiveQuestionCard
          request={{ kind: 'form', schema: props.request.schema }}
          locked={props.locked}
          onRespond={props.onRespond}
        />
      }
    >
      <Match when={typed()?.name === 'CreateCalendarEvent' && typed()}>
        {(tool) => (
          <CalendarDraftComposer
            initialData={tool().data as CreateCalendarEvent}
            sink={sink<CreateCalendarEvent>()}
            previewKey={props.toolCall}
          />
        )}
      </Match>
      <Match when={typed()?.name === 'SendEmail' && typed()}>
        {(tool) => (
          <div class="flex flex-col gap-2">
            <EmailDraftComposer
              initialData={tool().data as SendEmail}
              sink={sink<SendEmail>()}
              debugName={`agent-review:${props.toolCall}`}
            />
            {/* The email composer has only Send; the calendar one answers a
                decline through the sink's `onReject`. Without this the turn
                could only be refused from the chip, or by stopping it. */}
            <div class="flex items-center gap-2">
              <Button
                variant="outline"
                size="xs"
                disabled={props.locked}
                onClick={() => void props.onRespond({ action: 'decline' })}
              >
                Cancel
              </Button>
            </div>
          </div>
        )}
      </Match>
    </Switch>
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
    .with({ kind: 'unrecognized' }, (v) => JSON.stringify(v.raw))
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
    props.part.reported ??
    (props.part.outcome.kind === 'accepted' ? props.part.outcome.answers : []);

  return (
    <ToolCard
      title="Question"
      subtitle={props.part.message}
      status={props.part.outcome.kind === 'errored' ? 'failed' : 'completed'}
      muted={props.part.outcome.kind === 'errored'}
      trailing={<span class="text-ink">{outcomeLabel(props.part)}</span>}
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
