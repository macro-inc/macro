import type {
  FoldedMessage,
  SessionMetadata,
  TurnState,
} from '@service-agent-fold/generated/types';
import { createRoot, createSignal } from 'solid-js';
import { expect, it } from 'vitest';
import { createReviewResponse } from './review-response';

const REVIEW = 'review-1';

const event = (id: string, turn: number, systemTurn = true) => ({
  id,
  subjectId: REVIEW,
  createdAt: '2026-10-23T20:00:00Z',
  turn,
  actionId: `action-${id}`,
  systemTurn,
});

const reply = (turn: number, text: string) =>
  ({
    author: { kind: 'agent' },
    turn,
    parts: [{ kind: 'text', text }],
  }) as unknown as FoldedMessage;

function session() {
  const [notifications, setNotifications] = createSignal<unknown[]>([]);
  const [noopTurn, setNoopTurn] = createSignal<number | null>(null);
  const [turn, setTurn] = createSignal<TurnState>('idle');
  const [messages, setMessages] = createSignal<FoldedMessage[]>([]);
  return {
    state: {
      metadata: () =>
        ({
          notifications: notifications(),
          noopTurn: noopTurn(),
        }) as unknown as SessionMetadata,
      messages,
      turn,
    },
    setNotifications,
    setNoopTurn,
    setTurn,
    setMessages,
  };
}

it('names the latest event about this review and nothing else', () =>
  createRoot((dispose) => {
    const s = session();
    const response = createReviewResponse(() => REVIEW, s.state);
    expect(response.eventId()).toBeUndefined();
    s.setNotifications([
      event('a', 1),
      { ...event('b', 2), subjectId: 'other' },
    ]);
    expect(response.eventId()).toBe('a');
    dispose();
  }));

it('is responding while a system turn about it runs, until the agent answers', () =>
  createRoot((dispose) => {
    const s = session();
    const response = createReviewResponse(() => REVIEW, s.state);
    s.setNotifications([event('a', 4)]);
    expect(response.responding()).toBe(false);
    s.setTurn('running');
    expect(response.responding()).toBe(true);
    s.setMessages([reply(4, 'Sent both emails.')]);
    expect(response.responding()).toBe(false);
    dispose();
  }));

it('stops responding for a turn the agent answered with <noop/>', () =>
  createRoot((dispose) => {
    const s = session();
    const response = createReviewResponse(() => REVIEW, s.state);
    s.setNotifications([event('a', 4)]);
    s.setTurn('running');
    s.setNoopTurn(4);
    expect(response.responding()).toBe(false);
    dispose();
  }));

it('responds from the moment a decision is sent here, until its event is answered', () =>
  createRoot((dispose) => {
    const s = session();
    const response = createReviewResponse(() => REVIEW, s.state);
    response.onDecision();
    expect(response.responding()).toBe(true);
    s.setTurn('running');
    s.setNotifications([event('a', 5)]);
    expect(response.responding()).toBe(true);
    s.setMessages([reply(5, 'Done.')]);
    expect(response.responding()).toBe(false);
    dispose();
  }));

it('stops responding when a decision sent here fails', () =>
  createRoot((dispose) => {
    const s = session();
    const response = createReviewResponse(() => REVIEW, s.state);
    response.onDecision();
    response.onDecisionFailed();
    expect(response.responding()).toBe(false);
    dispose();
  }));
