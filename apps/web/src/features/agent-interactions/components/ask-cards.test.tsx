/** @vitest-environment jsdom */

import type { ElicitationSchema } from '@service-agent-fold/generated/types';
import { cleanup, fireEvent, render } from '@solidjs/testing-library';
import { afterEach, describe, expect, it, vi } from 'vitest';

type StubSink = {
  canAct: () => boolean;
  lockedNotice: () => string | undefined;
  onEdit?: (args: unknown) => void;
  onExecute: (args: unknown) => Promise<boolean>;
  onReject: () => Promise<boolean>;
};
type StubProps = { initialData: unknown; sink: StubSink };
const composer = vi.hoisted(() => ({
  email: undefined as StubProps | undefined,
  event: undefined as StubProps | undefined,
}));
vi.mock('@core/component/AI/component/tool/email/DraftComposer', () => ({
  EmailDraftComposer: (props: StubProps) => {
    composer.email = props;
    return <div>email composer</div>;
  },
}));
vi.mock('@core/component/AI/component/tool/calendar/DraftComposer', () => ({
  CalendarDraftComposer: (props: StubProps) => {
    composer.event = props;
    return <div>event composer</div>;
  },
}));
vi.mock('@app/features/block-agent/component/parts/UserToolCall', () => ({
  EmailDraft: (props: { email: { body: string } }) => (
    <div>{props.email.body}</div>
  ),
  EventDraft: () => <div>event draft</div>,
}));

import type {
  InteractionController,
  InteractionDraft,
} from '../context/interaction';
import { ApprovalCard } from './ApprovalCard';
import { DraftCard, emailDraftLabel, recipientsTitle } from './DraftCard';
import { InteractionCard } from './InteractionCard';
import { QuestionCard, quickAnswers } from './QuestionCard';

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  composer.email = undefined;
  composer.event = undefined;
});

function answer(options: string[]): ElicitationSchema {
  return {
    title: null,
    description: null,
    required: ['answer'],
    properties: [
      {
        name: 'answer',
        title: 'Answer',
        description: null,
        schema: {
          type: 'string',
          minLength: null,
          maxLength: null,
          pattern: null,
          format: null,
          default: null,
          options: options.map((value) => ({
            value,
            title: value,
            description: null,
          })),
          customField: null,
        },
      },
    ],
  };
}

describe('a question card', () => {
  it('answers two or three short options with one press', () => {
    const respond = vi.fn(async () => true);
    const view = render(() => (
      <QuestionCard
        message="Send it to the whole team or just leads?"
        request={{ kind: 'form', schema: answer(['Whole team', 'Just leads']) }}
        locked={false}
        canAnswer
        onRespond={respond}
      />
    ));
    expect(
      view.getByText('Send it to the whole team or just leads?')
    ).toBeTruthy();
    expect(view.queryByRole('button', { name: 'Submit' })).toBeNull();
    fireEvent.click(view.getByRole('button', { name: 'Just leads' }));
    expect(respond).toHaveBeenCalledWith({
      action: 'accept',
      content: { answer: 'Just leads' },
    });
  });

  it('lists more options to choose from, and skips', () => {
    const respond = vi.fn(async () => true);
    const view = render(() => (
      <QuestionCard
        message="Which deck should I start from?"
        request={{
          kind: 'form',
          schema: answer([
            'Q3 board review',
            'Q2 investor update',
            'Scratch',
            'Other deck',
          ]),
        }}
        locked={false}
        canAnswer
        onRespond={respond}
      />
    ));
    expect(view.getByRole('button', { name: 'Submit' })).toBeTruthy();
    fireEvent.click(view.getByRole('button', { name: 'Skip' }));
    expect(respond).toHaveBeenCalledWith({ action: 'decline' });
  });

  it('tells a viewer who cannot answer why, with nothing to press', () => {
    const view = render(() => (
      <QuestionCard
        message="Which deck?"
        request={{ kind: 'form', schema: answer(['A', 'B']) }}
        locked
        canAnswer={false}
        onRespond={vi.fn()}
      />
    ));
    expect(
      view.getByText('Only someone who can edit this agent can answer.')
    ).toBeTruthy();
    expect(view.queryByRole('button')).toBeNull();
  });

  it('keeps long or open answers out of the quick form', () => {
    expect(
      quickAnswers({ kind: 'form', schema: answer(['Yes', 'No']) })
    ).toBeTruthy();
    expect(
      quickAnswers({ kind: 'form', schema: answer(['Yes']) })
    ).toBeUndefined();
    expect(
      quickAnswers({
        kind: 'form',
        schema: answer(['Yes', 'No, and here is a long reason why not']),
      })
    ).toBeUndefined();
    expect(quickAnswers({ kind: 'form', schema: answer([]) })).toBeUndefined();
  });
});

describe('an approval card', () => {
  const options = [
    { id: 'allow', name: 'Allow this time', kind: 'allow_once' as const },
    { id: 'deny', name: 'Deny', kind: 'reject_once' as const },
  ];

  it('says what will happen, folds the raw input away, and allows once', () => {
    const select = vi.fn();
    const view = render(() => (
      <ApprovalCard
        action="Create document"
        detail="Launch FAQ"
        input={'{"documentName": "Launch FAQ"}'}
        options={options}
        canAnswer
        onSelect={select}
      />
    ));
    expect(view.getByText('Create document')).toBeTruthy();
    expect(view.getByText('Launch FAQ')).toBeTruthy();
    expect(view.queryByText('{"documentName": "Launch FAQ"}')).toBeNull();
    fireEvent.click(view.getByRole('button', { name: 'Show input' }));
    expect(view.getByText('{"documentName": "Launch FAQ"}')).toBeTruthy();
    fireEvent.click(view.getByRole('button', { name: 'Allow once' }));
    expect(select).toHaveBeenCalledWith('allow');
  });

  it('waits on someone else when this viewer cannot answer', () => {
    const view = render(() => (
      <ApprovalCard
        action="Run a command"
        detail="rm -rf dist"
        options={options}
        canAnswer={false}
        onSelect={vi.fn()}
      />
    ));
    expect(
      view.getByText('Waiting for someone who can edit this agent to approve')
    ).toBeTruthy();
    expect(view.queryByRole('button', { name: 'Allow once' })).toBeNull();
  });
});

describe('a draft card', () => {
  const email = {
    to: [
      { email: 'ana@example.com', name: 'Ana Ruiz' },
      { email: 'leo@example.com' },
    ],
    subject: 'Launch plan',
    body: 'Hi Ana, here is the plan.',
  };
  const event = {
    title: 'Launch review',
    time: {
      kind: 'timed' as const,
      startsAt: '2026-10-20T15:00:00Z',
      endsAt: '2026-10-20T15:30:00Z',
      timeZone: 'UTC',
    },
  };
  const draft = (
    tool: { name: string; data: unknown },
    respond = vi.fn(async () => true),
    review?: { canAnswer: () => boolean },
    canAnswer?: boolean,
    composes = true
  ) =>
    render(() => (
      <DraftCard
        tool={tool}
        toolCall="call-1"
        message="Send email?"
        review={{ canAnswer: review?.canAnswer ?? (() => true), respond }}
        canAnswer={canAnswer}
        composes={composes}
        fallback={<div>flat form</div>}
      />
    ));

  it('is the email in its composer, whose Send sends it as it stands', async () => {
    const respond = vi.fn(async () => true);
    const view = draft({ name: 'SendEmail', data: email }, respond);
    expect(view.getByText('email composer')).toBeTruthy();
    expect(
      view.getByRole('region', {
        name: 'Draft email to Ana Ruiz and 1 other: Launch plan',
      })
    ).toBeTruthy();
    expect(composer.email?.initialData).toEqual(email);
    expect(composer.email?.sink.lockedNotice()).toBeUndefined();
    await composer.email?.sink.onExecute(email);
    expect(respond).toHaveBeenCalledWith({
      action: 'accept',
      content: { draft: JSON.stringify(email) },
    });
  });

  it('discards from under the composer, which has only Send', () => {
    const respond = vi.fn(async () => true);
    const view = draft({ name: 'SendEmail', data: email }, respond);
    fireEvent.click(view.getByRole('button', { name: 'Discard' }));
    expect(respond).toHaveBeenCalledWith({ action: 'decline' });
  });

  it('tells a viewer who cannot send it who can, with nothing to press', () => {
    const respond = vi.fn(async () => true);
    const view = draft(
      { name: 'SendEmail', data: email },
      respond,
      { canAnswer: () => false },
      false
    );
    expect(composer.email?.sink.canAct()).toBe(false);
    expect(composer.email?.sink.lockedNotice()).toBe(
      'Only someone who can edit this agent can send this.'
    );
    expect(view.queryByRole('button', { name: 'Discard' })).toBeNull();
  });

  it('says nothing of who can while its own answer is on its way', () => {
    const view = draft({ name: 'SendEmail', data: email }, undefined, {
      canAnswer: () => false,
    });
    expect(composer.email?.sink.lockedNotice()).toBeUndefined();
    const discard = view.getByRole('button', { name: 'Discard' });
    expect((discard as HTMLButtonElement).disabled).toBe(true);
  });

  it("is the event in the calendar's composer, whose Cancel discards it", async () => {
    const respond = vi.fn(async () => true);
    const view = draft({ name: 'CreateCalendarEvent', data: event }, respond);
    expect(view.getByText('event composer')).toBeTruthy();
    expect(
      view.getByRole('region', { name: 'Draft event: Launch review' })
    ).toBeTruthy();
    expect(view.queryByRole('button', { name: 'Discard' })).toBeNull();
    await composer.event?.sink.onReject();
    expect(respond).toHaveBeenCalledWith({ action: 'decline' });
    await composer.event?.sink.onExecute(event);
    expect(respond).toHaveBeenLastCalledWith({
      action: 'accept',
      content: { draft: JSON.stringify(event) },
    });
  });

  it("is someone else's draft as the agent wrote it, sent as written", async () => {
    // The session is not the viewer's: the composer, with its inbox and
    // signature, is the owner's.
    const respond = vi.fn(async () => true);
    const view = draft(
      { name: 'SendEmail', data: email },
      respond,
      undefined,
      undefined,
      false
    );
    expect(view.queryByText('email composer')).toBeNull();
    expect(view.getByText('Ana Ruiz and 1 other')).toBeTruthy();
    expect(view.getByText('Draft email · Launch plan')).toBeTruthy();
    expect(view.getByText('Hi Ana, here is the plan.')).toBeTruthy();
    fireEvent.click(view.getByRole('button', { name: 'Send' }));
    expect(respond).toHaveBeenCalledWith({
      action: 'accept',
      content: { draft: JSON.stringify(email) },
    });
    fireEvent.click(view.getByRole('button', { name: 'Discard' }));
    expect(respond).toHaveBeenLastCalledWith({ action: 'decline' });
  });

  it("tells a viewer who cannot answer someone else's draft who can", () => {
    const view = draft(
      { name: 'CreateCalendarEvent', data: event },
      undefined,
      { canAnswer: () => false },
      false,
      false
    );
    expect(view.queryByText('event composer')).toBeNull();
    expect(view.getByText('event draft')).toBeTruthy();
    expect(
      view.getByText('Only someone who can edit this agent can create this.')
    ).toBeTruthy();
    expect(view.queryByRole('button')).toBeNull();
  });

  it('asks in a card for a tool this client has no composer for', () => {
    const view = draft({ name: 'CreateBookingLink', data: {} });
    expect(view.getByText('Send email?')).toBeTruthy();
    expect(view.getByRole('button', { name: 'Dismiss request' })).toBeTruthy();
  });

  it('names who an email goes to', () => {
    expect(recipientsTitle([])).toBe('New email');
    expect(recipientsTitle([{ email: 'a@x.test' }])).toBe('a@x.test');
    expect(
      recipientsTitle([
        { email: 'a@x.test', name: 'Ada' },
        { email: 'b@x.test' },
        { email: 'c@x.test' },
      ])
    ).toBe('Ada and 2 others');
    expect(emailDraftLabel({ to: [], subject: ' ', body: '' })).toBe(
      'Draft email'
    );
    expect(
      emailDraftLabel({ to: [{ email: 'a@x.test' }], subject: 'Hi', body: '' })
    ).toBe('Draft email to a@x.test: Hi');
  });
});

describe('an ask card that comes back', () => {
  const question = {
    kind: 'elicitation' as const,
    turn: 1,
    requestId: 'ask-1',
    toolCall: null,
    message: 'What should the title say?',
    request: { kind: 'form' as const, schema: answer([]) },
  };

  it('keeps what was typed into a question when its card comes back', () => {
    // Held by the controller, not the card: the typing row comes and goes.
    const drafts = new Map<string, InteractionDraft>();
    const respond = vi.fn(async () => true);
    const controller: InteractionController = {
      pending: () => [question],
      canAnswer: () => true,
      answerers: 'someone who can edit this agent',
      owns: () => true,
      answering: () => false,
      respond,
      draft: (request) => drafts.get(String(request.requestId)),
      keepDraft: (request, draft) =>
        drafts.set(String(request.requestId), draft),
    };
    const card = () => (
      <InteractionCard request={question} controller={controller} />
    );
    const first = render(card);
    fireEvent.input(first.getByRole('textbox'), {
      target: { value: 'Q4 launch plan' },
    });
    first.unmount();

    const again = render(card);
    const field = again.getByRole('textbox') as HTMLInputElement;
    expect(field.value).toBe('Q4 launch plan');
    fireEvent.click(again.getByRole('button', { name: 'Submit' }));
    expect(respond).toHaveBeenCalledWith({
      ...question,
      answer: { action: 'accept', content: { answer: 'Q4 launch plan' } },
    });
  });

  it('reopens an email in its composer with the edit kept', () => {
    const email = {
      to: [{ email: 'ana@example.com', name: 'Ana Ruiz' }],
      subject: 'Launch plan',
      body: 'Hi Ana',
    };
    let kept: unknown;
    const card = () => (
      <DraftCard
        tool={{ name: 'SendEmail', data: email }}
        toolCall="call-1"
        message="Send email?"
        review={{ canAnswer: () => true, respond: vi.fn(async () => true) }}
        composes
        fallback={<div>flat form</div>}
        draft={{ saved: kept, save: (draft) => (kept = draft) }}
      />
    );
    const first = render(card);
    const edited = { ...email, subject: 'Launch plan (final)' };
    composer.email?.sink.onEdit?.(edited);
    first.unmount();

    const again = render(card);
    expect(composer.email?.initialData).toEqual(edited);
    expect(
      again.getByRole('region', {
        name: 'Draft email to Ana Ruiz: Launch plan (final)',
      })
    ).toBeTruthy();
  });
});
