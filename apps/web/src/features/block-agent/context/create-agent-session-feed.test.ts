/**
 * @vitest-environment jsdom
 *
 * The live path, end to end below the socket: a frame handed to
 * `handleAgentSessionLog` (what `SyncProvider` calls) must reach the feed's
 * ordered store without a refetch.
 */

import type { FoldedMessage } from '@service-agent-fold/generated/types';
import type { AgentSessionResponse } from '@service-agent-harness/generated/schemas';
import { createRoot } from 'solid-js';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const worker = vi.hoisted(() => ({
  /** Messages the fold machine reports for the session. */
  messages: [] as FoldedMessage[],
  /** Events the next `pushSessionEntries` resolves with. */
  pushed: [] as { kind: string; message: FoldedMessage }[],
  getSession: async (): Promise<{
    isErr: () => boolean;
    value: Partial<AgentSessionResponse>;
  }> => ({
    isErr: () => false,
    value: {
      id: 'session',
      name: 'Agent Session',
      modifiedAt: '2026-08-24T12:00:00Z',
      harness: 'claude-code',
    },
  }),
}));

const emptyMetadata = {
  model: null,
  supportedModels: [],
  title: null,
  availableCommands: [],
  status: null,
};

vi.mock('@core/agent-fold/client', () => ({
  openSession: vi.fn(async () => ({
    messages: [],
    metadata: emptyMetadata,
  })),
  closeSession: vi.fn(),
  sessionMessages: vi.fn(async () => ({
    messages: worker.messages,
    metadata: { ...emptyMetadata, title: 'Fixture session' },
  })),
  pushSessionEntries: vi.fn(async () => worker.pushed),
}));

vi.mock('@service-agent-harness/client', () => ({
  agentHarnessServiceClient: {
    get: vi.fn(() => worker.getSession()),
    getLog: vi.fn(async () => ({
      isErr: () => false,
      value: { bot: { id: 'bot', name: 'Agent' }, entries: [] },
    })),
  },
}));

function message(
  turn: number,
  author: 'user' | 'agent',
  text: string,
  stop: FoldedMessage['stop'] = null
): FoldedMessage {
  return {
    agentSessionId: 'session',
    requestId: null,
    turn,
    author:
      author === 'user' ? { kind: 'user', userId: null } : { kind: 'agent' },
    parts: [{ kind: 'text', text }],
    stop,
  };
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('createAgentSessionFeed live updates', () => {
  beforeEach(() => {
    worker.messages = [];
    worker.pushed = [];
    worker.getSession = async () => ({
      isErr: () => false,
      value: {
        id: 'session',
        name: 'Agent Session',
        modifiedAt: '2026-08-24T12:00:00Z',
        harness: 'claude-code',
      },
    });
    vi.resetModules();
  });

  it('applies a streamed frame without refetching', async () => {
    const { createAgentSessionFeed } = await import(
      './create-agent-session-feed'
    );
    const { handleAgentSessionLog } = await import(
      '@queries/agent-session/session-fold'
    );

    worker.messages = [message(0, 'user', 'hi')];

    const feed = createRoot(() => createAgentSessionFeed(() => 'session'));
    await flush();
    await flush();
    expect(feed.messages().map((m) => m.parts)).toHaveLength(1);

    // A live frame arrives: the fold reports a new agent message.
    worker.pushed = [{ kind: 'new', message: message(0, 'agent', 'working') }];
    handleAgentSessionLog({
      agentSessionId: 'session',
      direction: 'to_server',
      content: { type: 'acp' },
    } as never);
    await flush();
    await flush();

    expect(feed.messages()).toHaveLength(2);
    expect(feed.messages()[1]?.parts[0]).toMatchObject({ text: 'working' });
    expect(feed.working()).toBe(true);
    // The acquisition's snapshot metadata and bot land on the feed.
    expect(feed.metadata()?.title).toBe('Fixture session');
    expect(feed.bot()?.name).toBe('Agent');
  });

  it('refreshes the persisted name after a rename notification', async () => {
    const { createAgentSessionFeed } = await import(
      './create-agent-session-feed'
    );
    const { handleAgentSessionRenamed } = await import(
      '@queries/agent-session/session-metadata-sync'
    );
    const feed = createRoot(() => createAgentSessionFeed(() => 'session'));
    await flush();

    expect(feed.session()?.name).toBe('Agent Session');
    worker.getSession = async () => ({
      isErr: () => false,
      value: {
        id: 'session',
        name: 'Fix Flaky Tests',
        modifiedAt: '2026-08-24T12:00:01Z',
        harness: 'claude-code',
      },
    });
    handleAgentSessionRenamed({
      agentSessionId: 'session',
      name: 'Fix Flaky Tests',
    });
    await flush();
    expect(feed.session()?.name).toBe('Fix Flaky Tests');
  });

  it('does not let an in-flight stale fetch overwrite a rename', async () => {
    let resolveSession!: (
      value: Awaited<ReturnType<typeof worker.getSession>>
    ) => void;
    let calls = 0;
    worker.getSession = () => {
      if (calls++ === 0) {
        return new Promise((resolve) => {
          resolveSession = resolve;
        });
      }
      return Promise.resolve({
        isErr: () => false,
        value: {
          id: 'session',
          name: 'Fix Flaky Tests',
          modifiedAt: '2026-08-24T12:00:01Z',
          harness: 'claude-code',
        },
      });
    };
    const { createAgentSessionFeed } = await import(
      './create-agent-session-feed'
    );
    const { handleAgentSessionRenamed } = await import(
      '@queries/agent-session/session-metadata-sync'
    );
    const feed = createRoot(() => createAgentSessionFeed(() => 'session'));

    handleAgentSessionRenamed({
      agentSessionId: 'session',
      name: 'Fix Flaky Tests',
    });
    await flush();
    resolveSession!({
      isErr: () => false,
      value: {
        id: 'session',
        name: 'Agent Session',
        modifiedAt: '2026-08-24T12:00:00Z',
        harness: 'claude-code',
      },
    });
    await flush();

    expect(feed.session()?.name).toBe('Fix Flaky Tests');
  });

  it('uses persisted state instead of a stale event payload', async () => {
    const { createAgentSessionFeed } = await import(
      './create-agent-session-feed'
    );
    const { handleAgentSessionRenamed } = await import(
      '@queries/agent-session/session-metadata-sync'
    );
    const feed = createRoot(() => createAgentSessionFeed(() => 'session'));
    await flush();

    worker.getSession = async () => ({
      isErr: () => false,
      value: {
        id: 'session',
        name: 'New Name',
        modifiedAt: '2026-08-24T12:00:02Z',
        harness: 'claude-code',
      },
    });
    handleAgentSessionRenamed({
      agentSessionId: 'session',
      name: 'Stale Name',
    });
    await flush();

    expect(feed.session()?.name).toBe('New Name');
  });

  it('does not re-read the snapshot for a session with no provider', async () => {
    let calls = 0;
    worker.getSession = async () => {
      calls += 1;
      return {
        isErr: () => false,
        value: {
          id: 'session',
          name: 'Agent Session',
          modifiedAt: '2026-08-24T12:00:00Z',
          harness: 'claude-code',
        },
      };
    };
    const { createAgentSessionFeed } = await import(
      './create-agent-session-feed'
    );

    worker.messages = [message(0, 'agent', 'done', { kind: 'end_turn' })];
    createRoot(() => createAgentSessionFeed(() => 'session'));
    await flush();
    await flush();
    await flush();

    expect(calls).toBe(1);
  });

  it('replaces a streaming message in place as it grows', async () => {
    const { createAgentSessionFeed } = await import(
      './create-agent-session-feed'
    );
    const { handleAgentSessionLog } = await import(
      '@queries/agent-session/session-fold'
    );

    worker.messages = [message(0, 'agent', 'partial')];
    const feed = createRoot(() => createAgentSessionFeed(() => 'session'));
    await flush();
    await flush();

    worker.pushed = [
      {
        kind: 'update',
        message: message(0, 'agent', 'partial then more', { kind: 'end_turn' }),
      },
    ];
    handleAgentSessionLog({
      agentSessionId: 'session',
      direction: 'to_server',
      content: { type: 'acp' },
    } as never);
    await flush();
    await flush();

    expect(feed.messages()).toHaveLength(1);
    expect(feed.messages()[0]?.parts[0]).toMatchObject({
      text: 'partial then more',
    });
    expect(feed.working()).toBe(false);
  });
});
