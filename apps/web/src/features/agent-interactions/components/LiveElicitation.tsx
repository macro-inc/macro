/**
 * The live controls for a question the agent is waiting on, shared by the
 * session's card and the channel's Magic Chip: a form's fields and Submit,
 * a URL's consent, and the refusal of a request this client cannot display.
 *
 * Fields and decisions are separate components over one draft so a surface
 * can place them apart: `QuestionCard` puts them in an `ElicitationCard`'s
 * body and footer for the session and a channel reply's live tail, and
 * `LiveQuestionCard` stacks them on a plain row (agent updates). A Macro
 * user tool under review opens in the tool's own composer
 * (`UserToolComposer`); a draft the tool's schema rejects, or a tool with no
 * composer here, falls back to the flat form the agent also sent, through
 * these.
 */

import { CalendarDraftComposer } from '@core/component/AI/component/tool/calendar/DraftComposer';
import { EmailDraftComposer } from '@core/component/AI/component/tool/email/DraftComposer';
import { fireAndForget } from '@core/util/fireAndForget';
import type {
  ElicitationRequest,
  ElicitationSchema,
} from '@service-agent-fold/generated/types';
import type { ElicitationAnswer } from '@service-agent-harness/generated/schemas';
import { deserializeToolCall } from '@service-cognition/generated/tools/tool';
import type {
  CreateCalendarEvent,
  SendEmail,
} from '@service-cognition/generated/tools/types';
import { Button, Card } from '@ui';
import {
  type Accessor,
  createMemo,
  createSignal,
  type JSX,
  Match,
  Show,
  Switch,
} from 'solid-js';
import { createStore } from 'solid-js/store';
import { match } from 'ts-pattern';
import {
  type FieldValue,
  type FormValues,
  initialValues,
  requiredAnswered,
  toContent,
  validate,
} from '../state/elicitation-form';
import { createElicitationReviewSink } from '../state/elicitation-review-sink';
import { ElicitationCard, type ElicitationSummary } from './ElicitationCard';
import { ElicitationForm } from './ElicitationForm';

export type RespondToElicitation = (
  answer: ElicitationAnswer
) => Promise<boolean>;

/** Every request the shared controls answer; a user tool is the surface's. */
export type LiveQuestionRequest = Exclude<
  ElicitationRequest,
  { kind: 'user_tool' }
>;

/** A form being filled in: what was typed, and what is wrong with it. */
export type FormDraft = {
  schema: ElicitationSchema;
  values: FormValues;
  /** Problems shown to the user - none until the first submit attempt. */
  errors: Accessor<Record<string, string>>;
  setValue: (name: string, value: FieldValue) => void;
  /** Every required field has an answer, so Submit can be pressed. */
  answered: Accessor<boolean>;
  /**
   * The content to accept with, or undefined while the draft is not valid -
   * from then on the problems show.
   */
  content: () => ReturnType<typeof toContent> | undefined;
};

/** A question with the state its controls need, made once per request. */
export type LiveQuestion =
  | { kind: 'form'; draft: FormDraft }
  | { kind: 'url'; url: string }
  | { kind: 'unrecognized'; mode: string };

function createFormDraft(schema: ElicitationSchema): FormDraft {
  const [values, setValues] = createStore(initialValues(schema));
  const [touched, setTouched] = createSignal(false);
  const problems = createMemo(() => validate(schema, values));
  return {
    schema,
    values,
    errors: () => (touched() ? problems() : {}),
    setValue: (name, value) => setValues(name, value),
    answered: () => requiredAnswered(schema, values),
    content: () => {
      setTouched(true);
      return Object.keys(problems()).length > 0
        ? undefined
        : toContent(schema, values);
    },
  };
}

/** The question's state; call it once per request, under a reactive owner. */
export function createLiveQuestion(request: LiveQuestionRequest): LiveQuestion {
  return match(request)
    .with(
      { kind: 'form' },
      ({ schema }): LiveQuestion => ({
        kind: 'form',
        draft: createFormDraft(schema),
      })
    )
    .with({ kind: 'url' }, ({ url }): LiveQuestion => ({ kind: 'url', url }))
    .with(
      { kind: 'unrecognized' },
      ({ mode }): LiveQuestion => ({ kind: 'unrecognized', mode })
    )
    .exhaustive();
}

function form(question: LiveQuestion) {
  return question.kind === 'form' ? question : undefined;
}

function url(question: LiveQuestion) {
  return question.kind === 'url' ? question : undefined;
}

function unrecognized(question: LiveQuestion) {
  return question.kind === 'unrecognized' ? question : undefined;
}

/** The host of a URL-mode request, for the consent card, or the raw text. */
function urlHost(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

/**
 * What a question shows: a form's fields, a URL and its host, or the notice
 * for a mode this client cannot display.
 */
export function QuestionFields(props: {
  question: LiveQuestion;
  locked: boolean;
}) {
  return (
    <Switch>
      <Match when={form(props.question)}>
        {(question) => (
          <ElicitationForm
            schema={question().draft.schema}
            values={question().draft.values}
            errors={question().draft.errors()}
            disabled={props.locked}
            onChange={question().draft.setValue}
          />
        )}
      </Match>
      <Match when={url(props.question)}>
        {(question) => (
          <div class="flex flex-col gap-2">
            <div class="text-xs text-ink-muted">
              Opens{' '}
              <span class="font-medium text-ink">
                {urlHost(question().url)}
              </span>{' '}
              in a new tab.
            </div>
            <div class="rounded-md border border-edge-muted bg-surface px-2 py-1 font-mono text-xs text-ink-muted break-all">
              {question().url}
            </div>
          </div>
        )}
      </Match>
      <Match when={unrecognized(props.question)}>
        {(question) => (
          <div class="text-xs text-ink-extra-muted italic">
            This client cannot display a "{question().mode}" request.
          </div>
        )}
      </Match>
    </Switch>
  );
}

/**
 * The decisions, as buttons: the question's own (Submit, Open) then Skip.
 * Skip declines, the one refusal whose effect is the same for every agent:
 * the agent goes on without an answer. Cancel is not offered beside it,
 * because no agent stops for it (Claude aborts the tool call and goes on,
 * Codex can't tell it from a decline); stopping the agent is the session's
 * own Stop. On a card they follow the
 * session's other cards (`ToolApprovalCard`): the refusals quiet on the left,
 * the question's own action on the right, and nothing primary.
 *
 * URL mode never opens anything on its own: only after the user presses Open
 * does it send the consent and open a new tab - never an iframe, never a
 * prefetch. Consent goes to the agent first so it learns the user agreed even
 * if the popup is blocked; the URL shown in the fields stays as the fallback.
 */
export function QuestionActions(props: {
  question: LiveQuestion;
  locked: boolean;
  onRespond: RespondToElicitation;
  /** Lay the buttons out for a card's footer rather than a plain row. */
  card?: boolean;
}) {
  const respond = (answer: ElicitationAnswer) => {
    if (props.locked) return;
    fireAndForget(props.onRespond(answer), 'agent-interactions');
  };
  const submit = (draft: FormDraft) => {
    const content = draft.content();
    if (content) respond({ action: 'accept', content });
  };
  const open = async (target: string) => {
    if (props.locked) return;
    const accepted = await props.onRespond({ action: 'accept' });
    if (!accepted) return;
    window.open(target, '_blank', 'noopener,noreferrer');
  };
  const size = () => (props.card ? 'md' : 'xs');

  const primary = (
    <Switch>
      <Match when={form(props.question)}>
        {(question) => (
          <Button
            variant={props.card ? 'secondary' : 'primary'}
            size={size()}
            disabled={props.locked || !question().draft.answered()}
            onClick={() => submit(question().draft)}
          >
            Submit
          </Button>
        )}
      </Match>
      <Match when={url(props.question)}>
        {(question) => (
          <Button
            variant={props.card ? 'secondary' : 'primary'}
            size={size()}
            disabled={props.locked}
            onClick={() =>
              fireAndForget(open(question().url), 'agent-interactions')
            }
          >
            Open
          </Button>
        )}
      </Match>
    </Switch>
  );
  const refusals = (
    <Button
      variant={props.card ? 'ghost' : 'secondary'}
      size={size()}
      tooltip="The agent continues without your answer"
      disabled={props.locked}
      onClick={() => respond({ action: 'decline' })}
    >
      Skip
    </Button>
  );

  return (
    <Show
      when={props.card}
      fallback={
        <>
          {primary}
          {refusals}
        </>
      }
    >
      <div class="flex items-center gap-1">{refusals}</div>
      <Card.Actions>{primary}</Card.Actions>
    </Show>
  );
}

/**
 * A form, URL or unrecognized request on its own card: the fields in the
 * body, the decisions in the footer.
 */
export function QuestionCard(props: {
  summary: ElicitationSummary;
  /** Placement on the card root, such as a height cap. */
  class?: string;
  request: LiveQuestionRequest;
  locked: boolean;
  onRespond: RespondToElicitation;
}) {
  // A request never changes for its card, so its state is made once.
  const question = createLiveQuestion(props.request);
  return (
    <ElicitationCard
      summary={props.summary}
      class={props.class}
      actions={
        <QuestionActions
          question={question}
          locked={props.locked}
          onRespond={props.onRespond}
          card
        />
      }
    >
      <QuestionFields question={question} locked={props.locked} />
    </ElicitationCard>
  );
}

/** The fields over the decisions, on a plain row with no card around them. */
export function LiveQuestionCard(props: {
  request: LiveQuestionRequest;
  locked: boolean;
  onRespond: RespondToElicitation;
  trailing?: JSX.Element;
}) {
  // A part's request never changes, so its state is made once.
  const question = createLiveQuestion(props.request);
  return (
    <div class="flex flex-col gap-3">
      <QuestionFields question={question} locked={props.locked} />
      <div class="flex flex-wrap items-center gap-2">
        <QuestionActions
          question={question}
          locked={props.locked}
          onRespond={props.onRespond}
        />
        <Show when={props.trailing}>
          <span class="ml-auto">{props.trailing}</span>
        </Show>
      </div>
    </div>
  );
}

export type UserToolRequest = Extract<
  ElicitationRequest,
  { kind: 'user_tool' }
>;

/** A drafted Macro user tool, as its schema reads it. */
export type DraftedTool = { name: string; data: unknown };

/** What a review needs to know to act: the session's or the chip's answer. */
export type ReviewInputs = Parameters<typeof createElicitationReviewSink>[0];

/**
 * The draft as the tool's schema reads it, or undefined for a tool this
 * client has no schema for. A draft that a known tool's schema rejects is a
 * contract break between the agent and this build: it is reported, not
 * rendered around, before the caller falls back to the flat form.
 */
export function parseDraftedTool(
  request: UserToolRequest,
  toolCall: string
): DraftedTool | undefined {
  // Old sessions may still contain a booking review. Keep its internal IDs out
  // of the generic form and let the user dismiss it to resume the conversation.
  if (
    request.tool === 'CreateBookingLink' ||
    request.tool === 'EditBookingLink'
  ) {
    return { name: request.tool, data: request.draft };
  }
  const call = deserializeToolCall({
    id: toolCall,
    name: request.tool,
    json: request.draft,
  });
  if (call.isOk()) return { name: call.value.name, data: call.value.data };
  if (call.error.some((problem) => problem.code === 'parse_error')) {
    console.error(
      '[elicitation] a user tool draft was rejected by its schema',
      {
        tool: request.tool,
        problems: call.error,
      }
    );
  }
  return undefined;
}

// The tools `UserToolComposer` opens; keep this in step with its `Switch`.
const composedTools = new Set([
  'CreateBookingLink',
  'EditBookingLink',
  'CreateCalendarEvent',
  'SendEmail',
]);

/**
 * The draft `UserToolComposer` can open, or undefined when the caller should
 * fall back to the flat form: a draft its schema rejects, or a tool with no
 * composer here.
 */
export function composableDraft(
  request: UserToolRequest,
  toolCall: string
): DraftedTool | undefined {
  const tool = parseDraftedTool(request, toolCall);
  return tool && composedTools.has(tool.name) ? tool : undefined;
}

/**
 * A drafted Macro user tool in the tool's own composer: the calendar event
 * form for `CreateCalendarEvent`, the email compose for `SendEmail`. The
 * composer's Create/Send accepts the review with the whole edited draft; its
 * Cancel, where it has one, declines. The email composer has only Send, so
 * `cancel` adds a Skip beneath it, which declines like a question's Skip, for
 * a surface with no other refusal.
 * Callers pass only a draft from `composableDraft`.
 */
export function UserToolComposer(props: {
  tool: DraftedTool;
  toolCall: string;
  review: ReviewInputs;
  cancel?: boolean;
}) {
  const sink = <T,>() => createElicitationReviewSink<T>(props.review);
  const locked = () => !props.review.canAnswer();
  return (
    <Switch>
      <Match
        when={
          props.tool.name === 'CreateBookingLink' ||
          props.tool.name === 'EditBookingLink'
        }
      >
        <div class="flex flex-col items-start gap-2 text-sm text-ink-muted">
          <p>
            Booking links are now confirmed in conversation. Dismiss this older
            request and ask the agent to summarize the details.
          </p>
          <Button
            size="xs"
            variant="ghost"
            disabled={locked()}
            onClick={() =>
              fireAndForget(
                props.review.respond({ action: 'decline' }),
                'agent-interactions'
              )
            }
          >
            Dismiss request
          </Button>
        </div>
      </Match>
      <Match when={props.tool.name === 'CreateCalendarEvent'}>
        <CalendarDraftComposer
          initialData={props.tool.data as CreateCalendarEvent}
          sink={sink<CreateCalendarEvent>()}
          previewKey={props.toolCall}
        />
      </Match>
      <Match when={props.tool.name === 'SendEmail'}>
        <div class="flex flex-col gap-2">
          <EmailDraftComposer
            initialData={props.tool.data as SendEmail}
            sink={sink<SendEmail>()}
            debugName={`agent-review:${props.toolCall}`}
          />
          <Show when={props.cancel}>
            <div class="flex items-center gap-2">
              <Button
                variant="ghost"
                size="xs"
                tooltip="The agent continues without sending it"
                disabled={locked()}
                onClick={() =>
                  fireAndForget(
                    props.review.respond({ action: 'decline' }),
                    'agent-interactions'
                  )
                }
              >
                Skip
              </Button>
            </div>
          </Show>
        </div>
      </Match>
    </Switch>
  );
}
