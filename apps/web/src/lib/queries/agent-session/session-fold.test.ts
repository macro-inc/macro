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
  dropOverlap,
  handleAgentSessionLog,
  subscribeAgentSessionLog,
} from './session-fold';

function frame(n: number): AgentSessionLogEntryDto {
  return {
    createdAt: `2026-08-13T00:00:0${n}Z`,
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

describe('buffer overlap', () => {
  const log = Array.from({ length: 10 }, (_, n) => frame(n));

  it('drops the longest buffered prefix already in the snapshot', () => {
    expect(dropOverlap(log.slice(0, 8), log.slice(5))).toEqual(log.slice(8));
    expect(
      dropOverlap([frame(1), frame(2), frame(2)], [frame(2), frame(2)])
    ).toEqual([]);
  });

  it('keeps frames that start after the snapshot or do not overlap', () => {
    expect(dropOverlap(log.slice(0, 6), log.slice(6))).toEqual(log.slice(6));
    expect(dropOverlap(log.slice(0, 4), [frame(99)])).toEqual([frame(99)]);
  });

  it('reconciles gaps, ordering, and duplicate occurrences', () => {
    expect(
      dropOverlap([frame(1), frame(2), frame(3)], [frame(3), frame(1)])
    ).toEqual([]);
    expect(dropOverlap([frame(1)], [frame(1), frame(1)])).toEqual([frame(1)]);
  });
});

describe('shared session folds', () => {
  it('buffers realtime overlap while fetching and replays only its suffix', async () => {
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
      frame(3),
    ]);
    (await acquired).release();
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
