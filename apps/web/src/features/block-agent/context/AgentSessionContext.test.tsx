/**
 * @vitest-environment jsdom
 *
 * The provider wires the bounded external-url query into the feed: a Cursor
 * session that loaded without `external.url` is polled, and the url lands on
 * the context snapshot without a second `createResource` load.
 */

import { CURSOR_BOT_ID } from '@core/constant/cursorAgent';
import type { FoldedMessage } from '@service-agent-fold/generated/types';
import type { AgentSessionResponse } from '@service-agent-harness/generated/schemas';
import { QueryClient, QueryClientProvider } from '@tanstack/solid-query';
import { render } from 'solid-js/web';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AgentSessionProvider, useAgentSession } from './AgentSessionContext';

const worker = vi.hoisted(() => ({
  messages: [] as FoldedMessage[],
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
  pushSessionEntries: vi.fn(async () => []),
}));

vi.mock('@service-agent-harness/client', () => ({
  agentHarnessServiceClient: {
    get: vi.fn(() => worker.getSession()),
    getLog: vi.fn(async () => ({
      isErr: () => false,
      value: { bot: { id: 'bot', name: 'Agent' }, entries: [] },
    })),
    control: vi.fn(async () => ({
      isErr: () => false,
      value: 'action-0',
    })),
  },
}));

vi.mock('@core/component/Toast/Toast', () => ({
  toast: { failure: vi.fn(), success: vi.fn() },
}));

let dispose: (() => void) | undefined;

function mountProvider(blockId = 'session') {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  let ctx!: ReturnType<typeof useAgentSession>;
  const Probe = () => {
    ctx = useAgentSession();
    return null;
  };
  dispose = render(
    () => (
      <QueryClientProvider client={client}>
        <AgentSessionProvider blockId={blockId}>
          <Probe />
        </AgentSessionProvider>
      </QueryClientProvider>
    ),
    document.body
  );
  return () => ctx;
}

describe('AgentSessionProvider external-url poll', () => {
  beforeEach(() => {
    worker.messages = [];
    worker.getSession = async () => ({
      isErr: () => false,
      value: {
        id: 'session',
        name: 'Agent Session',
        modifiedAt: '2026-08-24T12:00:00Z',
        harness: 'claude-code',
      },
    });
    dispose?.();
    dispose = undefined;
    document.body.innerHTML = '';
  });

  afterEach(() => {
    dispose?.();
    dispose = undefined;
  });

  it('polls a Cursor session until the snapshot carries a url', async () => {
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
          botId: CURSOR_BOT_ID,
          external:
            calls > 1
              ? {
                  provider: 'cursor',
                  name: 'Add a health check',
                  url: 'https://cursor.com/agents/bc-1',
                }
              : undefined,
        },
      };
    };

    const session = mountProvider();
    await vi.waitFor(() =>
      expect(session().session()?.external?.url).toBe(
        'https://cursor.com/agents/bc-1'
      )
    );
    expect(calls).toBeGreaterThanOrEqual(2);
  });

  it('does not poll a session that is not Cursor', async () => {
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

    mountProvider();
    await vi.waitFor(() => expect(calls).toBeGreaterThanOrEqual(1));
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(calls).toBe(1);
  });
});
