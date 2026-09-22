import type {
  FoldedMessage,
  FoldedStreamEvent,
  SessionMetadata,
} from '@service-agent-fold/generated/types';
import { ok } from 'neverthrow';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mock = vi.hoisted(() => ({
  load: vi.fn(),
  snapshot: vi.fn(),
  issue: vi.fn(),
  subscribe: vi.fn(),
  release: vi.fn(),
  cancel: vi.fn(),
}));
vi.mock('@core/agent-session/AgentSession', () => ({
  AgentSession: { acquire: () => mock },
}));
vi.mock('@service-agent-harness/voice', () => ({
  agentVoiceClient: { cancel: mock.cancel },
}));

import { createAgentVoiceBridge } from './session-bridge';

const task = '0195a574-e470-7a43-b74c-d06a7f374836';
const metadata = {
  pendingInteractions: [],
  turn: 'idle',
} as unknown as SessionMetadata;
let listener: (events: FoldedStreamEvent[]) => void;
function message(
  author: 'agent' | 'user',
  parts: FoldedMessage['parts'],
  options: Partial<FoldedMessage> = {}
): FoldedMessage {
  return {
    agentSessionId: 'session',
    author:
      author === 'user' ? { kind: 'user', userId: 'me' } : { kind: 'agent' },
    requestId: author === 'user' ? task : null,
    turn: 1,
    parts,
    stop: null,
    pending: false,
    ...options,
  };
}
beforeEach(() => {
  vi.clearAllMocks();
  mock.load.mockResolvedValue({ session: { canEdit: true } });
  mock.snapshot.mockResolvedValue({ messages: [], metadata });
  mock.subscribe.mockImplementation((value) => {
    listener = value;
    return vi.fn();
  });
  mock.issue.mockResolvedValue(ok({ actionId: task, status: 'sent' }));
});
describe('voice harness bridge', () => {
  it('deduplicates provider retries and rejects changed content under the same ID', async () => {
    const bridge = await createAgentVoiceBridge('session', 'me', vi.fn());
    const request = {
      version: 1 as const,
      requestId: task,
      prompt: 'Find my draft',
    };
    await Promise.all([bridge.request(request), bridge.request(request)]);
    expect(mock.issue).toHaveBeenCalledExactlyOnceWith(
      { type: 'prompt', prompt: 'Find my draft' },
      { userId: 'me', actionId: task }
    );
    expect(
      (await bridge.request({ ...request, prompt: 'Delete it' })).status
    ).toBe('conflict');
    bridge.close();
  });
  it('publishes public text only for the task’s confirmed turn', async () => {
    const publish = vi.fn();
    const bridge = await createAgentVoiceBridge('session', 'me', publish);
    await bridge.request({
      version: 1,
      requestId: task,
      prompt: 'Find my draft',
    });
    listener([
      {
        kind: 'new',
        message: message('user', [{ kind: 'text', text: 'Find my draft' }]),
      },
      {
        kind: 'new',
        message: message(
          'agent',
          [
            { kind: 'thought', text: 'secret reasoning' },
            { kind: 'text', text: 'Found the draft.' },
          ],
          { stop: { kind: 'end_turn' } }
        ),
      },
    ]);
    expect(publish).toHaveBeenCalledExactlyOnceWith({
      version: 1,
      taskId: task,
      type: 'completed',
      text: 'Found the draft.',
    });
    bridge.close();
    listener([{ kind: 'metadata', metadata }]);
    expect(publish).toHaveBeenCalledOnce();
  });
  it('does not publish speculative completions or another turn', async () => {
    const publish = vi.fn();
    const bridge = await createAgentVoiceBridge('session', 'me', publish);
    await bridge.request({ version: 1, requestId: task, prompt: 'Find' });
    listener([
      {
        kind: 'new',
        message: message('user', [{ kind: 'text', text: 'Find' }], {
          pending: true,
        }),
      },
      {
        kind: 'new',
        message: message('agent', [{ kind: 'text', text: 'Do not speak' }], {
          stop: { kind: 'end_turn' },
        }),
      },
    ]);
    expect(publish).not.toHaveBeenCalled();
    bridge.close();
  });
  it('returns bounded public context and excludes pending messages', async () => {
    mock.snapshot.mockResolvedValue({
      messages: Array.from({ length: 40 }, (_, turn) =>
        message(
          'agent',
          [
            { kind: 'thought', text: 'SECRET' },
            { kind: 'text', text: 'x'.repeat(3000) },
          ],
          { turn }
        )
      ),
      metadata,
    });
    const bridge = await createAgentVoiceBridge('session', 'me', vi.fn());
    const context = await bridge.context();
    expect(context.messages.length).toBeLessThanOrEqual(24);
    expect(
      context.messages.reduce((count, item) => count + item.text.length, 0)
    ).toBeLessThanOrEqual(8000);
    expect(JSON.stringify(context)).not.toContain('SECRET');
    bridge.close();
  });
  it('releases the shared session if the user cannot control it', async () => {
    mock.load.mockResolvedValue({ session: { canEdit: false } });
    await expect(
      createAgentVoiceBridge('session', 'me', vi.fn())
    ).rejects.toThrow('edit access');
    expect(mock.release).toHaveBeenCalledOnce();
  });
  it('observes a replacement that completes before cancellation responds', async () => {
    const replacement = '0195a574-e470-7a43-b74c-d06a7f374837';
    const publish = vi.fn();
    const bridge = await createAgentVoiceBridge('session', 'me', publish);
    await bridge.request({ version: 1, requestId: task, prompt: 'Original' });
    mock.cancel.mockImplementation(async () => {
      listener([
        {
          kind: 'new',
          message: message('user', [{ kind: 'text', text: 'Replacement' }], {
            turn: 2,
            requestId: replacement,
          }),
        },
        {
          kind: 'new',
          message: message(
            'agent',
            [{ kind: 'text', text: 'Replacement done' }],
            { turn: 2, stop: { kind: 'end_turn' } }
          ),
        },
      ]);
      return ok({ status: 'replaced', replacementActionId: replacement });
    });
    const request = {
      version: 1 as const,
      requestId: replacement,
      taskId: task,
      replacementPrompt: 'Replacement',
    };
    await Promise.all([bridge.cancel(request), bridge.cancel(request)]);
    expect(mock.cancel).toHaveBeenCalledOnce();
    expect(publish).toHaveBeenCalledExactlyOnceWith({
      version: 1,
      taskId: replacement,
      type: 'completed',
      text: 'Replacement done',
    });
    bridge.close();
  });
  it('cannot cancel a task owned by another voice conversation', async () => {
    const bridge = await createAgentVoiceBridge('session', 'me', vi.fn());
    expect(
      await bridge.cancel({ version: 1, requestId: task, taskId: task })
    ).toMatchObject({ status: 'conflict' });
    expect(mock.cancel).not.toHaveBeenCalled();
    bridge.close();
  });
  it('fits multilingual and escaped context into a LiveKit RPC', async () => {
    mock.snapshot.mockResolvedValue({
      messages: Array.from({ length: 24 }, (_, turn) =>
        message('agent', [{ kind: 'text', text: '界\n\u0000'.repeat(3000) }], {
          turn,
        })
      ),
      metadata,
    });
    const bridge = await createAgentVoiceBridge('session', 'me', vi.fn());
    expect(
      new TextEncoder().encode(JSON.stringify(await bridge.context()))
        .byteLength
    ).toBeLessThan(15_000);
    bridge.close();
  });
});
