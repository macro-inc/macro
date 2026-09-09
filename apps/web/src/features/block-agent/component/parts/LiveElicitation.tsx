/**
 * The live controls for a question the agent is waiting on, shared by the
 * session's card and the channel's Magic Chip: a form's fields and Submit,
 * a URL's consent, and the refusal of a request this client cannot display.
 *
 * Fields and decisions are separate components over one draft so a surface
 * can place them apart - the chip scrolls the fields in a side pane and
 * keeps the decisions on its bottom row - while `LiveQuestionCard` stacks
 * them for the session. A Macro user tool under review is each surface's
 * own (the session opens the tool's composer, the chip a read-only summary);
 * a surface that cannot show the tool answers the flat form the agent also
 * sent through these.
 */

import type {
  ElicitationRequest,
  ElicitationSchema,
} from '@service-agent-fold/generated/types';
import type { ElicitationAnswer } from '@service-agent-harness/generated/schemas';
import { Button } from '@ui';
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
import {
  type FieldValue,
  type FormValues,
  initialValues,
  toContent,
  validate,
} from '../../state/elicitation-form';
import { ElicitationForm } from '../../ui';

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
  switch (request.kind) {
    case 'form':
      return { kind: 'form', draft: createFormDraft(request.schema) };
    case 'url':
      return { kind: 'url', url: request.url };
    case 'unrecognized':
      return { kind: 'unrecognized', mode: request.mode };
  }
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
 * The decisions, as buttons for the caller's row: the question's own
 * (Submit, Open) then Decline and, unless the row is short of room, Cancel.
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
  /** Whether Cancel joins Decline; default yes. */
  cancel?: boolean;
  /** Decline before the question's own button, as the chip's row reads. */
  declineFirst?: boolean;
}) {
  const respond = (answer: ElicitationAnswer) => {
    if (props.locked) return;
    void props.onRespond(answer);
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

  const primary = (
    <Switch>
      <Match when={form(props.question)}>
        {(question) => (
          <Button
            variant="cta"
            size="xs"
            disabled={props.locked}
            onClick={() => submit(question().draft)}
          >
            Submit
          </Button>
        )}
      </Match>
      <Match when={url(props.question)}>
        {(question) => (
          <Button
            variant="cta"
            size="xs"
            disabled={props.locked}
            onClick={() => void open(question().url)}
          >
            Open
          </Button>
        )}
      </Match>
    </Switch>
  );
  const decline = (
    <Button
      variant="outline"
      size="xs"
      disabled={props.locked}
      onClick={() => respond({ action: 'decline' })}
    >
      Decline
    </Button>
  );

  return (
    <>
      {props.declineFirst ? decline : primary}
      {props.declineFirst ? primary : decline}
      <Show when={props.cancel ?? true}>
        <Button
          variant="ghost"
          size="xs"
          disabled={props.locked}
          onClick={() => respond({ action: 'cancel' })}
        >
          Cancel
        </Button>
      </Show>
    </>
  );
}

/** The fields over the decisions, as the session's card lays them out. */
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
