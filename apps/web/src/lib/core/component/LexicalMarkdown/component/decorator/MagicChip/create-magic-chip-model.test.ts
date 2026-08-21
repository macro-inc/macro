import type { MagicChipDecoratorProps } from '@macro-inc/lexical-core';
import type { FoldedMessage } from '@service-agent-fold/generated/types';
import { createRoot } from 'solid-js';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const sessionFold = vi.hoisted(() => ({
  acquireAgentSessionFold: vi.fn(),
  subscribeAgentSessionLog: vi.fn(),
}));
const serviceClient = vi.hoisted(() => ({ get: vi.fn() }));

vi.mock('@queries/agent-session/session-fold', () => sessionFold);
vi.mock('@service-agent-harness/client', () => ({
  agentHarnessServiceClient: serviceClient,
}));

import { createMagicChipModel } from './create-magic-chip-model';

const prompt: FoldedMessage = {
  requestId: null,
  agentSessionId: 'session',
  turn: 0,
  author: { kind: 'user', userId: 'macro|wolf@macro.com' },
  parts: [{ kind: 'text', text: 'Say hi' }],
  stop: null,
};

const response: FoldedMessage = {
  requestId: null,
  agentSessionId: 'session',
  turn: 0,
  author: { kind: 'agent' },
  parts: [{ kind: 'text', text: 'Hi!' }],
  stop: { kind: 'end_turn' },
};

const props = {
  agentSessionId: 'session',
  promptedMessage: { turn: 0, author: 'user' },
  status: 'acp_ready',
} as MagicChipDecoratorProps;

describe('createMagicChipModel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sessionFold.subscribeAgentSessionLog.mockReturnValue(vi.fn());
    sessionFold.acquireAgentSessionFold.mockResolvedValue({
      messages: [prompt, response],
      release: vi.fn(),
    });
    serviceClient.get.mockResolvedValue({
      isOk: () => true,
      value: { status: { kind: 'disconnected' } },
    });
  });

  it('settles after the attached turn completes despite stale acp_ready status', async () => {
    let presentation!: ReturnType<typeof createMagicChipModel>['presentation'];
    const dispose = createRoot((rootDispose) => {
      presentation = createMagicChipModel(props).presentation;
      return rootDispose;
    });

    await Promise.resolve();

    expect(presentation()).toEqual({ kind: 'settled', markdown: 'Hi!' });
    expect(sessionFold.acquireAgentSessionFold).toHaveBeenCalledWith({
      agentSessionId: 'session',
      onChange: expect.any(Function),
    });

    dispose();
  });

  it('hydrates a disconnected status from the session', async () => {
    sessionFold.acquireAgentSessionFold.mockResolvedValue({
      messages: [],
      release: vi.fn(),
    });
    let presentation!: ReturnType<typeof createMagicChipModel>['presentation'];
    const dispose = createRoot((rootDispose) => {
      presentation = createMagicChipModel(props).presentation;
      return rootDispose;
    });

    await Promise.resolve();
    await Promise.resolve();

    expect(presentation()).toEqual({
      kind: 'working',
      activity: { label: 'Session disconnected', busy: false },
    });

    dispose();
  });
});
