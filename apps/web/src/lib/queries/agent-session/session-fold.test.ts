import type { FoldedMessage } from '@service-agent-fold/generated/types';
import type {
  AgentSessionLogEntryDto,
  AgentSessionLogResponse,
} from '@service-agent-harness/generated/schemas';
import type { Result } from 'neverthrow';
import { err, ok } from 'neverthrow';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const fold = vi.hoisted(() => ({
  closeSession: vi.fn(),
  openSession: vi.fn(),
  pushSessionEntries: vi.fn(),
  sessionMessages: vi.fn(),
}));
const harness = vi.hoisted(() => ({ getLog: vi.fn() }));

vi.mock('@core/agent-fold/client', () => fold);
vi.mock('@service-agent-harness/client', () => ({
  agentHarnessServiceClient: harness,
}));

import {
  acquireAgentSessionFold,
  handleAgentSessionLog,
  subscribeAgentSessionLog,
} from './session-fold';

function frame(n: number): AgentSessionLogEntryDto {
  return {
    id: `00000000-0000-0000-0000-${n.toString(16).padStart(12, '0')}`,
    createdAt: new Date(Date.UTC(2026, 7, 13, 0, 0, n)).toISOString(),
    direction: 'to_server',
    content: { type: 'acp', jsonrpc: '2.0', id: n },
  } as unknown as AgentSessionLogEntryDto;
}

function event(session: string, n: number) {
  return { agentSessionId: session, ...frame(n) };
}

const bot = { id: 'bot-id', name: 'Agent' };
const message = { agentSessionId: 'session-a' } as FoldedMessage;
const metadata = {
  model: null,
  supportedModels: [],
  title: null,
  availableCommands: [],
  status: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  fold.openSession.mockResolvedValue({ messages: [message], metadata });
  fold.sessionMessages.mockResolvedValue({ messages: [message], metadata });
  fold.pushSessionEntries.mockResolvedValue([]);
  harness.getLog.mockResolvedValue(ok({ bot, entries: [] }));
});

describe('shared session folds', () => {
  it('passes buffered overlap to the durable fold after fetching', async () => {
    // This test verifies that buffered entries are replayed during opening.
    // Sinks are registered AFTER getting the snapshot to prevent duplicate
    // notifications: replayed entries update the worker but don't notify sinks,
    // then the caller receives the full snapshot (including replayed messages).
    let resolveFetch!: (
      value: Result<AgentSessionLogResponse, unknown>
    ) => void;
    harness.getLog.mockReturnValue(
      new Promise<Result<AgentSessionLogResponse, unknown>>((resolve) => {
        resolveFetch = resolve;
      })
    );
    const acquired = acquireAgentSessionFold({ agentSessionId: 'session-a' });
    handleAgentSessionLog(event('session-a', 2));
    handleAgentSessionLog(event('session-a', 3));
    resolveFetch(ok({ bot, entries: [frame(1), frame(2)] }));
    await acquired;

    expect(fold.openSession).toHaveBeenCalledWith('session-a', [
      frame(1),
      frame(2),
    ]);
    expect(fold.pushSessionEntries).toHaveBeenCalledWith('session-a', [
      frame(2),
      frame(3),
    ]);
    (await acquired).release();
  });

  it('drains every raced row to Rust in delivery order before becoming ready', async () => {
    let resolveFetch!: (
      value: Result<AgentSessionLogResponse, unknown>
    ) => void;
    harness.getLog.mockReturnValue(
      new Promise((resolve) => {
        resolveFetch = resolve;
      })
    );
    const oldChunk = {
      ...frame(1),
      content: {
        type: 'acp',
        jsonrpc: '2.0',
        method: 'session/update',
        params: {
          sessionId: 'runtime',
          update: {
            sessionUpdate: 'agent_message_chunk',
            content: { type: 'text', text: 'obsolete' },
          },
        },
      },
    };
    const oldLifecycle = {
      ...frame(2),
      content: { type: 'event', event: 'disconnected' },
    };
    const snapshot = [frame(3), frame(4), frame(5)];
    const acquired = acquireAgentSessionFold({
      agentSessionId: 'boundary-race',
    });
    handleAgentSessionLog({ agentSessionId: 'boundary-race', ...oldChunk });
    handleAgentSessionLog({ agentSessionId: 'boundary-race', ...oldLifecycle });
    handleAgentSessionLog(event('boundary-race', 4));
    handleAgentSessionLog(event('boundary-race', 6));
    // The successful load selects row 3 while GET is in flight. More obsolete
    // and overlapping delivery arrives during both opening and pushing.
    fold.openSession.mockImplementationOnce(async () => {
      handleAgentSessionLog({ agentSessionId: 'boundary-race', ...oldChunk });
      handleAgentSessionLog(event('boundary-race', 5));
    });
    fold.pushSessionEntries.mockImplementationOnce(async () => {
      handleAgentSessionLog({
        agentSessionId: 'boundary-race',
        ...oldLifecycle,
      });
      handleAgentSessionLog(event('boundary-race', 4));
      handleAgentSessionLog(event('boundary-race', 7));
      return [];
    });
    resolveFetch(ok({ bot, entries: snapshot }));
    const result = await acquired;
    expect(fold.openSession).toHaveBeenCalledWith('boundary-race', snapshot);
    expect(fold.pushSessionEntries.mock.calls).toEqual([
      [
        'boundary-race',
        [oldChunk, oldLifecycle, frame(4), frame(6), oldChunk, frame(5)],
      ],
      ['boundary-race', [oldLifecycle, frame(4), frame(7)]],
    ]);
    result.release();
  });

  it('isolates raw and folded events by session', async () => {
    const raw: string[] = [];
    const changed: FoldedMessage[][] = [];
    const unsubscribe = subscribeAgentSessionLog('session-b', (value) =>
      raw.push(value.agentSessionId)
    );
    const acquired = await acquireAgentSessionFold({
      agentSessionId: 'session-a',
      onChange: (messages) => changed.push(messages),
    });
    fold.pushSessionEntries.mockResolvedValue([{ kind: 'insert', message }]);

    handleAgentSessionLog(event('session-b', 1));
    await Promise.resolve();

    expect(raw).toEqual(['session-b']);
    expect(fold.pushSessionEntries).not.toHaveBeenCalled();
    expect(changed).toEqual([]);
    unsubscribe();
    acquired.release();
  });

  it('shares one fetch and machine until the last idempotent release', async () => {
    const first = await acquireAgentSessionFold({
      agentSessionId: 'session-a',
    });
    const second = await acquireAgentSessionFold({
      agentSessionId: 'session-a',
    });

    expect(harness.getLog).toHaveBeenCalledTimes(1);
    expect(fold.openSession).toHaveBeenCalledTimes(1);
    expect(first.bot).toEqual(bot);
    first.release();
    first.release();
    expect(fold.closeSession).not.toHaveBeenCalled();
    second.release();
    expect(fold.closeSession).toHaveBeenCalledOnce();
    expect(fold.closeSession).toHaveBeenCalledWith('session-a');
  });

  it('routes metadata push events to metadata sinks, latest wins', async () => {
    const seen: unknown[] = [];
    const acquired = await acquireAgentSessionFold({
      agentSessionId: 'session-a',
      onMetadata: (value) => seen.push(value),
    });
    expect(acquired.metadata).toEqual(metadata);

    fold.pushSessionEntries.mockResolvedValue([
      { kind: 'metadata', metadata: { ...metadata, title: 'First' } },
      { kind: 'metadata', metadata: { ...metadata, title: 'Second' } },
    ]);
    handleAgentSessionLog(event('session-a', 1));
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(seen).toEqual([{ ...metadata, title: 'Second' }]);
    acquired.release();
  });

  it('delivers replacements in order, including empty replacements, only to the matching session', async () => {
    const seen: unknown[] = [];
    const other = vi.fn();
    const acquired = await acquireAgentSessionFold({
      agentSessionId: 'session-a',
      onChange: (messages) => seen.push(['change', messages]),
      onReplace: (messages) => seen.push(['replace', messages]),
    });
    const second = await acquireAgentSessionFold({
      agentSessionId: 'session-b',
      onReplace: other,
    });
    fold.pushSessionEntries.mockResolvedValue([
      { kind: 'new', message },
      { kind: 'replace', messages: [] },
      { kind: 'replace', messages: [message] },
      { kind: 'update', message },
    ]);
    handleAgentSessionLog(event('session-a', 1));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(seen).toEqual([
      ['change', [message]],
      ['replace', []],
      ['replace', [message]],
      ['change', [message]],
    ]);
    expect(other).not.toHaveBeenCalled();
    acquired.release();
    second.release();
  });

  it('releases a failed acquisition without retaining shared state', async () => {
    harness.getLog.mockResolvedValueOnce(
      err([{ code: 'HTTP_ERROR', message: 'nope' }])
    );
    await expect(
      acquireAgentSessionFold({ agentSessionId: 'session-a' })
    ).rejects.toThrow();
    await acquireAgentSessionFold({ agentSessionId: 'session-a' });
    expect(harness.getLog).toHaveBeenCalledTimes(2);
  });
});
