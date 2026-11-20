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

function controller(canAnswer: boolean) {
  const respond = vi.fn<(response: InteractionResponse) => Promise<boolean>>(
    () => Promise.resolve(true)
  );
  const value: InteractionController = {
    pending: () => [],
    canAnswer: () => canAnswer,
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

  it('a question from an agent that is gone reads as such and cannot be answered', () => {
    const { value, respond } = controller(false);
    const view = render(() => (
      <InteractionCard request={formQuestion} controller={value} />
    ));
    const card = within(view.getByRole('region', { name: 'Agent question' }));
    card.getByText('The agent is asking');
    card.getByText(
      'This agent is no longer available. You can still read the conversation.'
    );
    expect(card.queryByText('Waiting for you')).toBeNull();
    for (const name of ['Submit', 'Decline', 'Cancel']) {
      const button = card.getByRole('button', { name });
      expect((button as HTMLButtonElement).disabled).toBe(true);
      fireEvent.click(button);
    }
    expect(respond).not.toHaveBeenCalled();
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
    for (const name of ['Submit', 'Decline', 'Cancel']) {
      expect(card.getAllByRole('button', { name })).toHaveLength(1);
    }
    // A card carries no primary button (design-system rule).
    expect(region.querySelector('[data-variant="primary"]')).toBeNull();
  });
});
