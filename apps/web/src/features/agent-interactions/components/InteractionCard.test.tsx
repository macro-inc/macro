/**
 * @vitest-environment jsdom
 *
 * A channel reply's live tail shows the agent's question on the same card as
 * the session: who asks, the question, its fields and decisions, answered
 * through the controller.
 */

import type { ElicitationSchema } from '@service-agent-fold/generated/types';
import { cleanup, fireEvent, render, within } from '@solidjs/testing-library';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type {
  AgentInteraction,
  InteractionController,
  InteractionResponse,
} from '../context/interaction';
import { InteractionCard } from './InteractionCard';

vi.mock('@core/component/AI/component/tool/calendar/DraftComposer', () => ({
  CalendarDraftComposer: () => <div data-testid="calendar-composer" />,
}));
vi.mock('@core/component/AI/component/tool/email/DraftComposer', () => ({
  EmailDraftComposer: () => <div data-testid="email-composer" />,
}));

afterEach(cleanup);

const colour: ElicitationSchema = {
  title: null,
  description: null,
  required: ['colour'],
  properties: [
    {
      name: 'colour',
      title: 'Header colour',
      description: null,
      schema: {
        type: 'string',
        minLength: null,
        maxLength: null,
        pattern: null,
        format: null,
        default: null,
        options: [
          { value: 'red', title: 'Red', description: null },
          { value: 'blue', title: 'Blue', description: null },
        ],
        customField: null,
      },
    },
  ],
};

function controller(canAnswer: boolean, accessKnown = true) {
  const respond = vi.fn<(response: InteractionResponse) => Promise<boolean>>(
    () => Promise.resolve(true)
  );
  const value: InteractionController = {
    pending: () => [],
    canAnswer: () => canAnswer,
    accessKnown: () => accessKnown,
    answering: () => false,
    respond,
  };
  return { value, respond };
}

const formQuestion: AgentInteraction = {
  kind: 'elicitation',
  requestId: 3,
  turn: 2,
  toolCall: 'toolu_1',
  message: 'Which colour should the header use?',
  request: { kind: 'form', schema: colour },
};

describe('InteractionCard', () => {
  it('asks in the agent name and sends the chosen answer', () => {
    const { value, respond } = controller(true);
    const view = render(() => (
      <InteractionCard
        request={formQuestion}
        controller={value}
        agentName="Macro"
      />
    ));
    const card = within(view.getByRole('region', { name: 'Agent question' }));
    card.getByText('Macro is asking');
    card.getByText('Waiting for you');
    card.getByText('Which colour should the header use?');
    fireEvent.click(card.getByRole('radio', { name: /Blue/ }));
    fireEvent.click(card.getByRole('button', { name: 'Submit' }));
    expect(respond).toHaveBeenCalledTimes(1);
    expect(respond).toHaveBeenCalledWith({
      kind: 'elicitation',
      requestId: 3,
      turn: 2,
      toolCall: 'toolu_1',
      message: 'Which colour should the header use?',
      request: { kind: 'form', schema: colour },
      answer: { action: 'accept', content: { colour: 'blue' } },
    });
  });

  it('a viewer who cannot edit the session sees who can answer, and cannot', () => {
    const { value, respond } = controller(false);
    const view = render(() => (
      <InteractionCard request={formQuestion} controller={value} />
    ));
    const card = within(view.getByRole('region', { name: 'Agent question' }));
    card.getByText('The agent is asking');
    card.getByText('Waiting for an editor');
    card.getByText('Only people who can edit this session can answer.');
    expect(card.queryByText('Waiting for you')).toBeNull();
    for (const name of ['Submit', 'Skip']) {
      const button = card.getByRole('button', { name });
      expect((button as HTMLButtonElement).disabled).toBe(true);
      fireEvent.click(button);
    }
    expect(respond).not.toHaveBeenCalled();
  });

  it('keeps Submit disabled until the required answer is chosen', () => {
    const { value, respond } = controller(true);
    const view = render(() => (
      <InteractionCard request={formQuestion} controller={value} />
    ));
    const card = within(view.getByRole('region', { name: 'Agent question' }));
    const submit = card.getByRole('button', { name: 'Submit' }) as HTMLButtonElement;
    expect(submit.disabled).toBe(true);
    fireEvent.click(submit);
    expect(respond).not.toHaveBeenCalled();
    fireEvent.click(card.getByRole('radio', { name: /Blue/ }));
    expect(submit.disabled).toBe(false);
  });

  it('claims nothing about access while it is still loading', () => {
    const { value } = controller(false, false);
    const view = render(() => (
      <InteractionCard request={formQuestion} controller={value} />
    ));
    const card = within(view.getByRole('region', { name: 'Agent question' }));
    expect(card.queryByText('Waiting for an editor')).toBeNull();
    expect(
      card.queryByText('Only people who can edit this session can answer.')
    ).toBeNull();
  });

  it('a user tool with no composer here asks with its flat form on the card', () => {
    const { value } = controller(true);
    const request: AgentInteraction = {
      ...formQuestion,
      request: {
        kind: 'user_tool',
        tool: 'WebSearch',
        draft: { query: 'header colours' },
        schema: colour,
      },
    };
    const view = render(() => (
      <InteractionCard request={request} controller={value} agentName="Macro" />
    ));
    const region = view.getByRole('region', { name: 'Agent question' });
    const card = within(region);
    card.getByRole('radio', { name: /Blue/ });
    for (const name of ['Submit', 'Skip']) {
      expect(card.getAllByRole('button', { name })).toHaveLength(1);
    }
    expect(card.queryByRole('button', { name: 'Cancel' })).toBeNull();
    // A card carries no primary button (design-system rule).
    expect(region.querySelector('[data-variant="primary"]')).toBeNull();
  });
});
