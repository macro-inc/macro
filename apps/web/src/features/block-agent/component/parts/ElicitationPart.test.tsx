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

vi.mock('../../context/AgentSessionContext', () => ({
  useAgentSession: () => ({
    bot: () => ({ name: 'Macro Coder' }),
    elicitation: {
      pending: () => pending,
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
});

describe('ElicitationPart', () => {
  it('offers the form only while the metadata names this question', () => {
    pending = live();
    const { queryByTestId, getByTestId } = render(() => (
      <ElicitationPart part={part()} />
    ));
    expect(queryByTestId('form')).not.toBeNull();
    expect(getByTestId('title').textContent).toContain('Macro Coder is asking');
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
