import { fetchWithToken } from '@core/util/fetchWithToken';
import { err, ok } from 'neverthrow';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { agentFeedbackClient } from './client';

vi.mock('@core/constant/servers', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@core/constant/servers')>()),
  SERVER_HOSTS: { 'agent-harness': 'https://harness.example.com' },
}));
vi.mock('@core/util/fetchWithToken', () => ({ fetchWithToken: vi.fn() }));

const HOST = 'https://harness.example.com/agent-feedback';

beforeEach(() => vi.clearAllMocks());

function lastCall() {
  const call = vi.mocked(fetchWithToken).mock.calls.at(-1);
  if (!call) throw new Error('No request');
  const [url, init] = call;
  return { url, init };
}

describe('agentFeedbackClient', () => {
  it('rates a session turn with the action id and note', async () => {
    vi.mocked(fetchWithToken).mockResolvedValue(
      ok({
        rating: 'down',
        note: 'wrong file',
        updatedAt: '2026-11-22T10:00:00Z',
      })
    );

    const result = await agentFeedbackClient.rate(
      { kind: 'agent_session_turn', sessionId: 'session-1', turn: 4 },
      {
        id: 'action-1',
        rating: 'down',
        note: 'wrong file',
        surface: 'agents_view',
      }
    );

    const { url, init } = lastCall();
    expect(url).toBe(`${HOST}/agent-sessions/session-1/turns/4`);
    expect(init?.method).toBe('PUT');
    expect(JSON.parse(String(init?.body))).toEqual({
      id: 'action-1',
      rating: 'down',
      note: 'wrong file',
      surface: 'agents_view',
    });
    expect(result._unsafeUnwrap()).toEqual({
      rating: 'down',
      note: 'wrong file',
      updatedAt: '2026-11-22T10:00:00Z',
    });
  });

  it('retracts a message rating with the id and surface in the query', async () => {
    vi.mocked(fetchWithToken).mockResolvedValue(ok({}));

    await agentFeedbackClient.retract(
      {
        kind: 'message',
        parentType: 'channel',
        parentId: 'channel-1',
        messageId: 'message-1',
      },
      { id: 'action-2', surface: 'message_thread' }
    );

    const { url, init } = lastCall();
    expect(url).toBe(
      `${HOST}/messages/channel/channel-1/items/message-1?id=action-2&surface=message_thread`
    );
    expect(init?.method).toBe('DELETE');
  });

  it('keys a routine read by run and a session read by turn', async () => {
    vi.mocked(fetchWithToken).mockResolvedValue(
      ok({
        items: [
          {
            subjectId: 'run-1',
            turn: null,
            rating: 'up',
            note: null,
            updatedAt: '2026-11-22T10:00:00Z',
          },
        ],
      })
    );
    const runs = await agentFeedbackClient.mine({
      kind: 'routine',
      routineId: 'routine-1',
    });
    expect(lastCall().url).toBe(`${HOST}/routines/routine-1/mine`);
    expect(runs._unsafeUnwrap().map((item) => item.key)).toEqual(['run-1']);

    vi.mocked(fetchWithToken).mockResolvedValue(
      ok({
        items: [
          {
            subjectId: 'session-1',
            turn: 2,
            rating: 'down',
            note: 'slow',
            updatedAt: '2026-11-22T10:00:00Z',
          },
        ],
      })
    );
    const turns = await agentFeedbackClient.mine({
      kind: 'agent_session',
      sessionId: 'session-1',
    });
    expect(lastCall().url).toBe(`${HOST}/agent-sessions/session-1/mine`);
    expect(turns._unsafeUnwrap()).toEqual([
      {
        key: '2',
        rating: 'down',
        note: 'slow',
        updatedAt: '2026-11-22T10:00:00Z',
      },
    ]);
  });

  it('passes a refusal through for the query to read as unavailable', async () => {
    vi.mocked(fetchWithToken).mockResolvedValue(
      err([{ code: 'NOT_FOUND', message: 'Resource not found' }])
    );

    const result = await agentFeedbackClient.mine({
      kind: 'message_parent',
      parentType: 'channel',
      parentId: 'channel-1',
    });

    expect(result.isErr() && result.error[0]?.code).toBe('NOT_FOUND');
  });
});
