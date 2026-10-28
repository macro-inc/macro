import type {
  FoldedMessage,
  SessionMetadata,
} from '@service-agent-fold/generated/types';
import { createSignal } from 'solid-js';

export const reviewId = '019a0000-0000-7000-8000-000000000005';
const [messages, setMessages] = createSignal<FoldedMessage[]>([]);
const [metadata, setMetadata] = createSignal<SessionMetadata>({
  harness: 'macro',
  model: null,
  supportedModels: [],
  configOptions: [],
  title: null,
  availableCommands: [],
  status: null,
  pendingInteractions: [],
  turn: 'idle',
  notifications: [],
  noopTurn: null,
});
export const session = {
  sessionId: () => '019a0000-0000-7000-8000-000000000001',
  userId: () => 'macro|owner@example.com',
  session: () => undefined,
  metadata,
  messages,
  turn: () => metadata().turn,
};
export const useOptionalAgentSession = () => session;

export function receiveDecision() {
  setMetadata((value) => ({
    ...value,
    turn: 'running',
    notifications: [
      {
        id: '019a0000-0000-7000-8000-000000000006',
        subjectId: reviewId,
        kind: 'review.decided',
        createdAt: '2026-10-21T00:00:00Z',
        payload: {
          outcome: 'approved',
          by: session.userId(),
          via: 'card',
          items: [],
        },
        turn: 1,
        actionId: '019a0000-0000-7000-8000-000000000007',
        systemTurn: true,
      },
    ],
  }));
}
export function receiveText(turn: number) {
  setMessages((values) => [
    ...values,
    {
      agentSessionId: session.sessionId(),
      turn,
      author: { kind: 'agent' },
      parts: [
        {
          kind: 'text',
          text:
            turn === 0
              ? 'Previous turn still streaming'
              : 'Your review is complete.',
        },
      ],
      requestId: null,
      stop: null,
      pending: false,
      segments: [],
      phase: null,
      postedAt: null,
    },
  ]);
}
export function receiveNoop() {
  setMetadata((value) => ({ ...value, noopTurn: 1, turn: 'idle' }));
}
