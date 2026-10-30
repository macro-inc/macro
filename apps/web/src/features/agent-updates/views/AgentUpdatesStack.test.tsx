import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const fake = vi.hoisted(() => ({ answer: vi.fn(async () => true) }));
vi.mock('@core/context/user', () => ({ useUserId: () => () => 'me' }));
vi.mock('../primitives/create-agent-updates', () => ({
  createAgentUpdates: () => ({
    updates: () => [
      {
        kind: 'interaction',
        id: 'session:permission:7',
        sessionId: 'session',
        sessionName: 'Build app',
        updatedAt: Date.now(),
        summary: 'Wants to run tests',
        request: {
          kind: 'permission',
          requestId: 7,
          turn: 1,
          toolCall: 'tool',
          options: [{ id: 'allow', name: 'Allow', kind: 'allow_once' }],
        },
      },
    ],
    answer: fake.answer,
    answering: () => false,
  }),
}));

import { AgentUpdatesStack } from './AgentUpdatesStack';

beforeEach(() => {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
  );
});

afterEach(() => {
  cleanup();
  fake.answer.mockClear();
  vi.unstubAllGlobals();
});

describe('AgentUpdatesStack', () => {
  it('answers an option and delegates chat and session navigation', () => {
    const onChatAbout = vi.fn();
    const onOpenSession = vi.fn();
    render(() => (
      <AgentUpdatesStack
        sessions={[]}
        onChatAbout={onChatAbout}
        onOpenSession={onOpenSession}
      />
    ));
    fireEvent.click(screen.getByRole('button', { name: 'Allow' }));
    fireEvent.click(screen.getByRole('button', { name: 'Chat about this' }));
    fireEvent.click(screen.getByRole('button', { name: 'Open session' }));
    expect(fake.answer).toHaveBeenCalledWith(
      expect.objectContaining({ sessionId: 'session' }),
      { optionId: 'allow' }
    );
    expect(onChatAbout).toHaveBeenCalledWith('session', 'Build app');
    expect(onOpenSession).toHaveBeenCalledWith('session');
  });
});
