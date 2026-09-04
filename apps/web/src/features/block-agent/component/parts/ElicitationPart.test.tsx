/**
 * @vitest-environment jsdom
 *
 * What this part must get right: a form is offered only while the fold says
 * the agent is still waiting on it, an answer sends exactly one key, and a
 * URL is never opened without the user pressing Open.
 */

import type {
  MessagePart,
  PendingElicitation,
} from '@service-agent-fold/generated/types';
import type { ElicitationAnswer } from '@service-agent-harness/generated/schemas';
import { fireEvent, render } from '@solidjs/testing-library';
import type { JSX } from 'solid-js';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const respond = vi.fn<(answer: ElicitationAnswer) => Promise<boolean>>();
let pending: PendingElicitation | undefined;
let canAnswer = true;

vi.mock('../../context/AgentSessionContext', () => ({
  useAgentSession: () => ({
    bot: () => ({ name: 'Macro Coder' }),
    elicitation: {
      pending: () => pending,
      canAnswer: () => canAnswer,
      ownerName: () => 'Alice Owner',
      answering: () => false,
      respond,
    },
  }),
}));

// The ui barrel reaches kobalte and svg sprites; the layer under test is the
// part's gating and what it sends, so the card and form are stubs that expose
// their props. `ElicitationForm` is a real component with its own file, but
// its inputs are plain HTML so the stub hands back a text box for the first
// property and an "Other" box when the field allows one.
vi.mock('../../ui', () => ({
  ToolCard: (props: {
    title: JSX.Element;
    subtitle?: string;
    trailing?: JSX.Element;
    status: string;
    children?: JSX.Element;
  }) => (
    <div data-testid="tool-card" data-status={props.status}>
      <span data-testid="title">{props.title}</span>
      <span data-testid="subtitle">{props.subtitle}</span>
      <span data-testid="trailing">{props.trailing}</span>
      <div data-testid="body">{props.children}</div>
    </div>
  ),
  ElicitationForm: (props: {
    schema: { properties: { name: string; schema: { type: string } }[] };
    onChange: (name: string, value: unknown) => void;
  }) => {
    const first = props.schema.properties[0]!;
    return (
      <div data-testid="form">
        <button
          type="button"
          data-testid="pick-red"
          onClick={() =>
            props.onChange(first.name, {
              kind: 'choice',
              value: 'Red',
              custom: '',
            })
          }
        />
        <button
          type="button"
          data-testid="type-other"
          onClick={() =>
            props.onChange(first.name, {
              kind: 'choice',
              value: undefined,
              custom: 'blue',
            })
          }
        />
      </div>
    );
  },
}));

// The composers are the chat block's real editors over calendar and email
// queries; the part's job is to pick one for the tool under review and wire
// its sink, so each stub exposes the sink through two buttons and its notice.
type StubSink = {
  canAct: () => boolean;
  lockedNotice: () => string | undefined;
  onExecute: (args: unknown) => Promise<boolean>;
  onReject: () => Promise<boolean>;
};
function composerStub(kind: string) {
  return (props: { initialData: unknown; sink: StubSink }) => (
    <div data-testid={`${kind}-composer`} data-can-act={props.sink.canAct()}>
      <span data-testid="locked-notice">{props.sink.lockedNotice()}</span>
      <button
        type="button"
        data-testid="composer-execute"
        onClick={() => void props.sink.onExecute(props.initialData)}
      />
      <button
        type="button"
        data-testid="composer-reject"
        onClick={() => void props.sink.onReject()}
      />
    </div>
  );
}
vi.mock('@core/component/AI/component/tool/calendar/DraftComposer', () => ({
  CalendarDraftComposer: composerStub('calendar'),
}));
vi.mock('@core/component/AI/component/tool/email/DraftComposer', () => ({
  EmailDraftComposer: composerStub('email'),
}));
vi.mock('./UserToolCall', () => ({
  UserToolCall: (props: {
    detail: { outcome: { kind: string } };
    common: { label: string; status: string };
  }) => (
    <div
      data-testid="user-tool"
      data-label={props.common.label}
      data-status={props.common.status}
      data-outcome={props.detail.outcome.kind}
    />
  ),
}));

import { ElicitationPart } from './ElicitationPart';

type Elicitation = Extract<MessagePart, { kind: 'elicitation' }>;

const colourForm: Elicitation['request'] = {
  kind: 'form',
  schema: {
    title: null,
    description: null,
    required: ['question_0'],
    properties: [
      {
        name: 'question_0',
        title: 'Best colour',
        description: null,
        schema: {
          type: 'string',
          minLength: null,
          maxLength: null,
          pattern: null,
          format: null,
          default: null,
          options: [
            { value: 'Red', title: 'Red', description: null },
            { value: 'Blue', title: 'Blue', description: null },
          ],
          customField: 'question_0_custom',
        },
      },
    ],
  },
};

function part(overrides: Partial<Elicitation> = {}): Elicitation {
  return {
    kind: 'elicitation',
    requestId: 0,
    toolCall: 'toolu_1',
    message: 'What is the best colour?',
    request: colourForm,
    outcome: { kind: 'pending' },
    reported: null,
    toolOutcome: null,
    ...overrides,
  };
}

function live(): PendingElicitation {
  return {
    requestId: 0,
    turn: 0,
    toolCall: 'toolu_1',
    message: 'What is the best colour?',
    request: colourForm,
  };
}

beforeEach(() => {
  respond.mockReset();
  respond.mockResolvedValue(true);
  pending = undefined;
  canAnswer = true;
});

describe('ElicitationPart', () => {
  it('offers the form only while the metadata names this question', () => {
    pending = live();
    const { queryByTestId, getByTestId } = render(() => (
      <ElicitationPart part={part()} />
    ));
    expect(queryByTestId('form')).not.toBeNull();
    expect(getByTestId('title').textContent).toContain('Macro Coder is asking');
    expect(getByTestId('trailing').textContent).toBe('Waiting for you');
  });

  it('a viewer who is not the owner sees the question locked and named for the owner', () => {
    pending = live();
    canAnswer = false;
    const { getByTestId, getByText } = render(() => (
      <ElicitationPart part={part()} />
    ));
    expect(getByTestId('trailing').textContent).toBe('Waiting for Alice Owner');
    expect(getByTestId('body').textContent).toContain(
      'Only Alice Owner can answer this.'
    );
    for (const label of ['Submit', 'Decline', 'Cancel']) {
      const button = getByText(label).closest('button');
      expect(button?.disabled).toBe(true);
      fireEvent.click(getByText(label));
    }
    expect(respond).not.toHaveBeenCalled();
  });

  it('reads as not answered once the agent has moved on', () => {
    pending = undefined;
    const { queryByTestId, getByTestId } = render(() => (
      <ElicitationPart part={part()} />
    ));
    expect(queryByTestId('form')).toBeNull();
    expect(getByTestId('trailing').textContent).toBe('Not answered');
  });

  it('a different pending question does not make this one live', () => {
    pending = { ...live(), requestId: 7 };
    const { queryByTestId } = render(() => <ElicitationPart part={part()} />);
    expect(queryByTestId('form')).toBeNull();
  });

  it('submits the chosen option under the property name', () => {
    pending = live();
    const { getByTestId, getByText } = render(() => (
      <ElicitationPart part={part()} />
    ));
    fireEvent.click(getByTestId('pick-red'));
    fireEvent.click(getByText('Submit'));
    expect(respond).toHaveBeenCalledWith({
      action: 'accept',
      content: { question_0: 'Red' },
    });
  });

  it('submits custom text under the custom key, and never both', () => {
    pending = live();
    const { getByTestId, getByText } = render(() => (
      <ElicitationPart part={part()} />
    ));
    fireEvent.click(getByTestId('type-other'));
    fireEvent.click(getByText('Submit'));
    expect(respond).toHaveBeenCalledWith({
      action: 'accept',
      content: { question_0_custom: 'blue' },
    });
  });

  it('refuses to submit an empty required form', () => {
    pending = live();
    const { getByText } = render(() => <ElicitationPart part={part()} />);
    fireEvent.click(getByText('Submit'));
    expect(respond).not.toHaveBeenCalled();
  });

  it('decline and cancel send their actions', () => {
    pending = live();
    const { getByText } = render(() => <ElicitationPart part={part()} />);
    fireEvent.click(getByText('Decline'));
    expect(respond).toHaveBeenCalledWith({ action: 'decline' });
    fireEvent.click(getByText('Cancel'));
    expect(respond).toHaveBeenCalledWith({ action: 'cancel' });
  });

  it('shows the harness-reported answer over what was sent', () => {
    const { getByTestId } = render(() => (
      <ElicitationPart
        part={part({
          outcome: {
            kind: 'accepted',
            content: { question_0: 'Red', question_0_custom: 'blue' },
          },
          reported: { 'What is the best colour?': 'blue' },
        })}
      />
    ));
    expect(getByTestId('trailing').textContent).toBe('Answered');
    expect(getByTestId('body').textContent).toContain('blue');
    expect(getByTestId('body').textContent).not.toContain('Red');
  });

  it('a url request shows the host and opens only after consent', async () => {
    const open = vi.spyOn(window, 'open').mockImplementation(() => null);
    pending = {
      ...live(),
      request: {
        kind: 'url',
        elicitationId: 'gh-1',
        url: 'https://agent.example.com/connect?e=gh-1',
      },
    };
    const { getByText } = render(() => (
      <ElicitationPart
        part={part({
          request: {
            kind: 'url',
            elicitationId: 'gh-1',
            url: 'https://agent.example.com/connect?e=gh-1',
          },
        })}
      />
    ));
    expect(getByText('agent.example.com')).not.toBeNull();
    expect(open).not.toHaveBeenCalled();
    fireEvent.click(getByText('Open'));
    await Promise.resolve();
    await Promise.resolve();
    expect(respond).toHaveBeenCalledWith({ action: 'accept' });
    expect(open).toHaveBeenCalledWith(
      'https://agent.example.com/connect?e=gh-1',
      '_blank',
      'noopener,noreferrer'
    );
    open.mockRestore();
  });

  describe('a user tool under review', () => {
    const eventDraft = {
      title: 'Q3 sync',
      time: {
        kind: 'timed',
        startsAt: '2026-08-20T17:00:00Z',
        endsAt: '2026-08-20T17:30:00Z',
        timeZone: 'UTC',
      },
      attendees: [],
      recurrenceLines: [],
      addGoogleMeet: false,
      eventType: 'default',
    };
    const emptySchema = {
      title: null,
      description: null,
      properties: [],
      required: [],
    };
    const review = (
      tool: string,
      draft: unknown
    ): Extract<Elicitation['request'], { kind: 'user_tool' }> => ({
      kind: 'user_tool',
      tool,
      draft,
      schema: emptySchema,
    });

    it("opens the tool's own composer, and Create answers with the whole draft", () => {
      const request = review('CreateCalendarEvent', eventDraft);
      pending = { ...live(), request };
      const { getByTestId, queryByTestId } = render(() => (
        <ElicitationPart
          part={part({ request, message: 'Create calendar event?' })}
        />
      ));
      expect(queryByTestId('form')).toBeNull();
      const composer = getByTestId('calendar-composer');
      expect(composer.dataset.canAct).toBe('true');
      expect(getByTestId('locked-notice').textContent).toBe('');
      fireEvent.click(getByTestId('composer-execute'));
      expect(respond).toHaveBeenCalledWith({
        action: 'accept',
        content: { draft: JSON.stringify(eventDraft) },
      });
      fireEvent.click(getByTestId('composer-reject'));
      expect(respond).toHaveBeenLastCalledWith({ action: 'decline' });
    });

    it('routes SendEmail to the email composer', () => {
      const request = review('SendEmail', {
        to: [{ email: 'alice@example.com' }],
        cc: [],
        bcc: [],
        subject: 'Q3 plan',
        body: 'Hi Alice',
      });
      pending = { ...live(), request };
      const { queryByTestId } = render(() => (
        <ElicitationPart part={part({ request })} />
      ));
      expect(queryByTestId('email-composer')).not.toBeNull();
    });

    // The email composer offers only Send, so the card carries the decline the
    // calendar composer answers through its own Cancel.
    it('an email review can be declined from the card', () => {
      const request = review('SendEmail', {
        to: [{ email: 'alice@example.com' }],
        cc: [],
        bcc: [],
        subject: 'Q3 plan',
        body: 'Hi Alice',
      });
      pending = { ...live(), request };
      const { getByText } = render(() => (
        <ElicitationPart part={part({ request })} />
      ));
      fireEvent.click(getByText('Cancel'));
      expect(respond).toHaveBeenCalledWith({ action: 'decline' });
    });

    it('a viewer who is not the owner gets the composer locked and told who can act', () => {
      canAnswer = false;
      const request = review('CreateCalendarEvent', eventDraft);
      pending = { ...live(), request };
      const { getByTestId } = render(() => (
        <ElicitationPart part={part({ request })} />
      ));
      expect(getByTestId('calendar-composer').dataset.canAct).toBe('false');
      expect(getByTestId('locked-notice').textContent).toBe(
        'Waiting for Alice Owner to answer.'
      );
      fireEvent.click(getByTestId('composer-execute'));
      expect(respond).not.toHaveBeenCalled();
    });

    it("falls back to the flat form for a draft the tool's schema rejects", () => {
      const request = {
        ...review('CreateCalendarEvent', { nonsense: true }),
        schema: colourForm.schema,
      };
      pending = { ...live(), request };
      const { queryByTestId } = render(() => (
        <ElicitationPart part={part({ request })} />
      ));
      expect(queryByTestId('calendar-composer')).toBeNull();
      expect(queryByTestId('form')).not.toBeNull();
    });

    it('once the tool has reported, the question reads as the tool it finished', () => {
      const request = review('CreateCalendarEvent', eventDraft);
      const { getByTestId } = render(() => (
        <ElicitationPart
          part={part({
            request,
            outcome: { kind: 'accepted', content: { draft: '{}' } },
            toolOutcome: {
              kind: 'completed',
              result: { eventId: 'evt-1', title: 'Q3 sync' },
            },
          })}
        />
      ));
      const tool = getByTestId('user-tool');
      expect(tool.dataset.label).toBe('CreateCalendarEvent');
      expect(tool.dataset.outcome).toBe('completed');
      expect(tool.dataset.status).toBe('completed');
    });

    it('a declined review with no tool report reads as a declined question', () => {
      const request = review('CreateCalendarEvent', eventDraft);
      const { getByTestId, queryByTestId } = render(() => (
        <ElicitationPart
          part={part({ request, outcome: { kind: 'declined' } })}
        />
      ));
      expect(queryByTestId('user-tool')).toBeNull();
      expect(getByTestId('trailing').textContent).toBe('Declined');
    });
  });

  it('a refused url consent does not open the tab', async () => {
    const open = vi.spyOn(window, 'open').mockImplementation(() => null);
    respond.mockResolvedValue(false);
    pending = {
      ...live(),
      request: {
        kind: 'url',
        elicitationId: 'gh-1',
        url: 'https://x.example/y',
      },
    };
    const { getByText } = render(() => (
      <ElicitationPart
        part={part({
          request: {
            kind: 'url',
            elicitationId: 'gh-1',
            url: 'https://x.example/y',
          },
        })}
      />
    ));
    fireEvent.click(getByText('Open'));
    await Promise.resolve();
    await Promise.resolve();
    expect(open).not.toHaveBeenCalled();
    open.mockRestore();
  });
});
