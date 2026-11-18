import type {
  SyncHost,
  SyncRunOutcome,
  SyncStartArgs,
} from '@graphql-cache/sync-protocol';
import { describe, expect, it, vi } from 'vitest';
import { runSyncPass } from './run';

vi.mock('@service-storage/mail-cache-profile', () => ({
  mailCacheProfile: async () => ({ profile: 'v5' }),
}));

const COMPLETE: SyncRunOutcome = {
  ok: true,
  result: { reason: 'complete', durationMs: 1, bytes: 0, lanes: [] },
};

function host() {
  return {
    syncStart: vi.fn(async (_args: SyncStartArgs) => COMPLETE),
    syncStop: vi.fn(async () => {}),
    syncState: vi.fn(async () => []),
  } satisfies SyncHost;
}

describe('runSyncPass', () => {
  it('names the pass and leaves planning the lanes to the server', async () => {
    const cache = host();
    await expect(
      runSyncPass(
        cache,
        'second',
        {
          completedSince: '2026-11-02T00:00:00.000Z',
          skipLanes: new Set(['email-older']),
          maxPages: 20,
        },
        { traceparent: '00-trace-span-01' }
      )
    ).resolves.toEqual(COMPLETE);
    const [args] = cache.syncStart.mock.calls[0] ?? [];
    expect(args).toMatchObject({
      pass: 'second',
      headers: {
        'x-macro-mail-cache-profile': 'v5',
        traceparent: '00-trace-span-01',
      },
      calendar: {
        timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      },
      completedSince: '2026-11-02T00:00:00.000Z',
      skipLanes: ['email-older'],
      maxPages: 20,
    });
    expect(args?.url).toMatch(/\/items\/soup\/graphql\/stream$/);
    expect(cache.syncState).not.toHaveBeenCalled();
  });

  it('asks for no calendar windows while calendars read REST', async () => {
    const cache = host();
    await runSyncPass(cache, 'first', {
      calendar: false,
      skipLanes: new Set(),
    });
    const [args] = cache.syncStart.mock.calls[0] ?? [];
    expect(args).not.toHaveProperty('calendar');
    expect(args).not.toHaveProperty('skipLanes');
    expect(args).not.toHaveProperty('maxPages');
  });
});
