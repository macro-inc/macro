import { createRoot, createSignal, type Setter } from 'solid-js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { UpdateSession } from '../core/agent-update';

const fake = vi.hoisted(() => ({
  acquired: vi.fn(),
  released: vi.fn(),
  issued: vi.fn(async (_action: unknown) => ({ isErr: () => false })),
  listeners: new Set<(events: unknown[]) => void>(),
  load: vi.fn(async () => {}),
  snapshot: vi.fn(async () => ({
    messages: [],
    metadata: { pendingInteractions: [] },
  })),
}));
vi.mock('@core/agent-session/AgentSession', () => ({
  AgentSession: {
    acquire: (id: string) => {
      fake.acquired(id);
      return {
        load: fake.load,
        snapshot: fake.snapshot,
        subscribe: (listener: (events: unknown[]) => void) => {
          fake.listeners.add(listener);
          return () => {
            fake.listeners.delete(listener);
          };
        },
        release: fake.released,
        issue: fake.issued,
      };
    },
  },
}));
vi.mock('@app/features/block-agent/queries/issue-session-action', () => ({
  issueSessionAction: (_session: unknown, action: unknown) =>
    fake.issued(action),
}));
vi.mock('@core/component/Toast/Toast', () => ({ toast: { failure: vi.fn() } }));

import { createAgentUpdates } from './create-agent-updates';

const blocked: UpdateSession = {
  id: 'blocked',
  name: 'Build',
  ownerId: 'me',
  botId: 'bot',
  harness: 'cursor',
  turnState: 'blocked',
  updatedAt: '2026-10-30T12:00:00Z',
};

afterEach(() => {
  fake.acquired.mockClear();
  fake.released.mockClear();
  fake.issued.mockClear();
  fake.listeners.clear();
  fake.snapshot.mockClear();
});

describe('createAgentUpdates', () => {
  it('acquires only blocked sessions and releases them on state change and cleanup', async () => {
    let dispose = () => {};
    let changeSessions: Setter<UpdateSession[]> = () => [];
    createRoot((close) => {
      dispose = close;
      const [sessions, setSessions] = createSignal<UpdateSession[]>([
        blocked,
        { ...blocked, id: 'running', turnState: 'running' },
      ]);
      changeSessions = setSessions;
      createAgentUpdates(sessions, () => 'me');
    });
    expect(fake.acquired.mock.calls.map(([id]) => id)).toEqual(['blocked']);
    changeSessions([{ ...blocked, turnState: 'running' }]);
    expect(fake.released).toHaveBeenCalledTimes(1);
    changeSessions([blocked]);
    expect(fake.acquired).toHaveBeenCalledTimes(2);
    dispose();
    expect(fake.released).toHaveBeenCalledTimes(2);
  });

  it('answers a live permission through the interaction controller', async () => {
    let dispose = () => {};
    let answerPromise: Promise<boolean> | undefined;
    createRoot((close) => {
      dispose = close;
      const model = createAgentUpdates(
        () => [blocked],
        () => 'me'
      );
      for (const listener of fake.listeners)
        listener([
          {
            kind: 'metadata',
            metadata: {
              pendingInteractions: [
                {
                  kind: 'permission',
                  requestId: 7,
                  turn: 1,
                  toolCall: 'tool',
                  options: [{ id: 'allow', name: 'Allow', kind: 'allow_once' }],
                },
              ],
            },
          },
        ]);
      const update = model.updates()[0];
      if (!update) throw new Error('Missing update');
      answerPromise = model.answer(update, { optionId: 'allow' });
    });
    await answerPromise;
    expect(fake.issued).toHaveBeenCalledWith({
      type: 'respondToPermission',
      requestId: 7,
      answer: { kind: 'selected', optionId: 'allow' },
    });
    dispose();
  });
});
