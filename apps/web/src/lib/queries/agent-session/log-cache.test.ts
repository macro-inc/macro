import 'fake-indexeddb/auto';
import type {
  AgentSessionLogEntryDto,
  AgentSessionResponse,
  SessionBot,
} from '@service-agent-harness/generated/schemas';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@core/constant/featureFlags', () => ({
  enableAgentSessionLogCache: { key: 'enable-agent-session-log-cache' },
  isFeatureEnabled: () => true,
}));
vi.mock('../client', () => ({ queryClient: {} }));

import {
  AGENT_SESSION_LOG_CACHE_MAX_ROWS,
  AGENT_SESSION_LOG_CACHE_TTL_MS,
  type CachedSessionLog,
  createAgentSessionLogCache,
  selectExpired,
} from './log-cache';

const DAY_MS = 24 * 60 * 60 * 1000;
const session = { id: 's1', name: 'A session' } as AgentSessionResponse;
const bot = { id: 'bot', name: 'Agent', handle: 'agent' } as SessionBot;
const row = (n: number) =>
  ({
    id: `row-${n}`,
    createdAt: '',
    direction: 'to_server',
  }) as unknown as AgentSessionLogEntryDto;
const log = (rows = [row(1)]) => ({ session, bot, rows });

let run = 0;
let identity: string | undefined;
let enabled: boolean;
let clock: number;
let dbName: string;

beforeEach(() => {
  dbName = `log-cache-test-${++run}`;
  identity = 'me';
  enabled = true;
  clock = Date.parse('2026-09-28T00:00:00Z');
});

const cache = () =>
  createAgentSessionLogCache({
    dbName,
    identity: () => identity,
    enabled: () => enabled,
    now: () => clock,
  });

describe('agentSessionLogCache', () => {
  it('reads back what it wrote, without the fencing fields', async () => {
    const store = cache();
    await store.write('s1', log());
    expect(await store.read('s1')).toEqual(log());
    expect(await store.read('other')).toBeUndefined();
  });

  it('hides entries from a different or missing user', async () => {
    const store = cache();
    await store.write('s1', log());
    identity = 'someone-else';
    expect(await store.read('s1')).toBeUndefined();
    identity = undefined;
    expect(await store.read('s1')).toBeUndefined();
    await store.write('s1', log([row(2)]));
    identity = 'me';
    expect(await store.read('s1')).toEqual(log());
  });

  it('does nothing while the flag is off', async () => {
    const store = cache();
    await store.write('s1', log());
    enabled = false;
    expect(await store.read('s1')).toBeUndefined();
    await store.write('s2', log());
    enabled = true;
    expect(await store.read('s2')).toBeUndefined();
  });

  it('ignores an entry past its time-to-live', async () => {
    const store = cache();
    await store.write('s1', log());
    clock += AGENT_SESSION_LOG_CACHE_TTL_MS + 1;
    expect(await store.read('s1')).toBeUndefined();
  });

  it('drops rather than saves a session over the row cap', async () => {
    const store = cache();
    await store.write('s1', log());
    const rows = Array.from(
      { length: AGENT_SESSION_LOG_CACHE_MAX_ROWS + 1 },
      (_, n) => row(n)
    );
    await store.write('s1', log(rows));
    expect(await store.read('s1')).toBeUndefined();
  });

  it('removes one entry, and clears them all for every user', async () => {
    const store = cache();
    await store.write('s1', log());
    await store.write('s2', log());
    await store.remove('s1');
    expect(await store.read('s1')).toBeUndefined();
    expect(await store.read('s2')).toEqual(log());
    await store.clear();
    expect(await store.read('s2')).toBeUndefined();
  });

  it('sweeps expired entries on first read', async () => {
    const writer = cache();
    await writer.write('old', log());
    clock += 8 * DAY_MS;
    await writer.write('new', log());

    const reader = cache();
    await reader.read('new');
    // The sweep runs after the read answers; let it land.
    await new Promise((resolve) => setTimeout(resolve, 0));
    clock -= 8 * DAY_MS;
    // Rewound, `old` would be readable again had the sweep not deleted it.
    expect(await reader.read('old')).toBeUndefined();
  });
});

describe('selectExpired', () => {
  const saved = (scopeId: string, savedAt: number) => ({
    scopeId,
    snapshot: { savedAt } as CachedSessionLog,
  });

  it('names the expired, then the oldest beyond the cap', () => {
    const now = 100;
    expect(
      selectExpired(
        [saved('a', 90), saved('b', 10), saved('c', 95), saved('d', 92)],
        now,
        { ttlMs: 50, maxSessions: 2 }
      )
    ).toEqual(['b', 'a']);
  });

  it('names nothing when everything fits', () => {
    expect(
      selectExpired([saved('a', 90), saved('b', 91)], 100, {
        ttlMs: 50,
        maxSessions: 2,
      })
    ).toEqual([]);
  });
});
