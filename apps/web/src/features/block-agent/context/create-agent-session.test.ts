/**
 * @vitest-environment jsdom
 *
 * A cached hydrate paints the transcript before the network load resolves,
 * so a reopen does not wait on GET /log.
 */

import type { AgentSessionRecord } from '@core/agent-session/AgentSession';
import type {
  FoldedMessage,
  SessionMetadata,
} from '@service-agent-fold/generated/types';
import type {
  AgentSessionResponse,
  SessionBot,
} from '@service-agent-harness/generated/schemas';
import { createRoot } from 'solid-js';
import { describe, expect, it, vi } from 'vitest';

const SESSION = '01a0abed-279f-724c-9f49-60dbedc79b6e';

const bot = { id: 'bot-id', name: 'Agent', handle: 'agent' } as SessionBot;
const sessionRow = {
  id: SESSION,
  name: 'Cached session',
  canEdit: true,
} as AgentSessionResponse;
const message = {
  turn: 1,
  author: { kind: 'user' },
  parts: [],
} as unknown as FoldedMessage;
const metadata = {
  turn: 'idle',
  title: 'Cached title',
} as SessionMetadata;

const load = vi.hoisted(() => {
  let resolve!: (value: AgentSessionRecord) => void;
  const promise = new Promise<AgentSessionRecord>((r) => {
    resolve = r;
  });
  return { promise, resolve: () => resolve };
});

const fake = vi.hoisted(() => ({
  id: '01a0abed-279f-724c-9f49-60dbedc79b6e',
  hydrate: vi.fn(),
  load: vi.fn(),
  snapshot: vi.fn(),
  subscribe: vi.fn(() => () => {}),
  release: vi.fn(),
  issue: vi.fn(),
  expect: vi.fn(),
  retract: vi.fn(),
}));

vi.mock('@core/agent-session/AgentSession', () => ({
  AgentSession: {
    acquire: () => fake,
  },
}));
vi.mock('@queries/agent-session/session-metadata-sync', () => ({
  subscribeAgentSessionRenamed: () => () => {},
  subscribeAgentSessionUpdated: () => () => {},
}));
vi.mock('@service-agent-harness/client', () => ({
  agentHarnessServiceClient: { get: vi.fn() },
}));

const { createAgentSession } = await import('./create-agent-session');

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('createAgentSession', () => {
  it('paints a cached hydrate before the network load resolves', async () => {
    const record = { session: sessionRow, bot };
    fake.hydrate.mockResolvedValue(record);
    fake.load.mockReturnValue(load.promise);
    fake.snapshot.mockResolvedValue({ messages: [message], metadata });

    await createRoot(async (dispose) => {
      const handle = createAgentSession(() => SESSION, {
        userId: () => 'macro|wolf@macro.com',
      });
      await flush();
      await flush();

      expect(handle.messages()).toEqual([message]);
      expect(handle.session()?.name).toBe('Cached session');
      expect(handle.bot()).toEqual(bot);
      expect(handle.metadata()?.title).toBe('Cached title');
      expect(handle.loadFailed()).toBe(false);

      load.resolve()(record);
      await flush();
      dispose();
    });
  });
});
