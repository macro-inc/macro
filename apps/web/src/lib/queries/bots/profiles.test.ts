import { err, ok } from 'neverthrow';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const getBotOwnerProfiles = vi.fn();

vi.mock('@service-storage/client', () => ({
  storageServiceClient: {
    getBotOwnerProfiles: (...args: unknown[]) => getBotOwnerProfiles(...args),
  },
}));

import { botProfileLoader } from './profiles';

const DEPLOY_BOT = '5f0c8a4e-2d1b-4c3a-9e7f-6a5b4c3d2e1f';
const TRIAGE_BOT = '7a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d';

function botIdAt(index: number): string {
  return `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`;
}

describe('botProfileLoader', () => {
  beforeEach(() => {
    getBotOwnerProfiles.mockReset();
  });

  it('sends concurrent ids in one request and maps each profile', async () => {
    getBotOwnerProfiles.mockResolvedValue(
      ok([
        {
          id: DEPLOY_BOT,
          name: 'Deploy Bot',
          avatar_url: 'https://example.com/deploy.png',
          deleted_at: null,
        },
        {
          id: TRIAGE_BOT,
          name: 'Triage Bot',
          avatar_url: null,
          deleted_at: '2026-09-01T00:00:00Z',
        },
      ])
    );

    const profiles = await Promise.all([
      botProfileLoader.load(DEPLOY_BOT),
      botProfileLoader.load(TRIAGE_BOT),
    ]);

    expect(getBotOwnerProfiles.mock.calls).toEqual([
      [{ ids: [DEPLOY_BOT, TRIAGE_BOT] }],
    ]);
    expect(profiles).toEqual([
      {
        name: 'Deploy Bot',
        avatarUrl: 'https://example.com/deploy.png',
        deleted: false,
      },
      { name: 'Triage Bot', avatarUrl: undefined, deleted: true },
    ]);
  });

  it('splits 101 ids into a request of 100 and a request of 1', async () => {
    getBotOwnerProfiles.mockImplementation(async ({ ids }: { ids: string[] }) =>
      ok(ids.map((id) => ({ id, name: 'Deploy Bot' })))
    );
    const ids = Array.from({ length: 101 }, (_, index) => botIdAt(index));

    const profiles = await Promise.all(
      ids.map((id) => botProfileLoader.load(id))
    );

    expect(getBotOwnerProfiles.mock.calls).toEqual([
      [{ ids: ids.slice(0, 100) }],
      [{ ids: [botIdAt(100)] }],
    ]);
    expect(profiles[100]).toEqual({
      name: 'Deploy Bot',
      avatarUrl: undefined,
      deleted: false,
    });
  });

  it('resolves an id the endpoint omits to null', async () => {
    getBotOwnerProfiles.mockResolvedValue(
      ok([{ id: DEPLOY_BOT, name: 'Deploy Bot' }])
    );

    const [known, omitted] = await Promise.all([
      botProfileLoader.load(DEPLOY_BOT),
      botProfileLoader.load(TRIAGE_BOT),
    ]);

    expect(known).toEqual({
      name: 'Deploy Bot',
      avatarUrl: undefined,
      deleted: false,
    });
    expect(omitted).toBeNull();
  });

  it('rejects a malformed id and still loads a valid one', async () => {
    getBotOwnerProfiles.mockResolvedValue(
      ok([{ id: DEPLOY_BOT, name: 'Deploy Bot' }])
    );

    const [good, bad] = await Promise.allSettled([
      botProfileLoader.load(DEPLOY_BOT),
      botProfileLoader.load('not-a-uuid'),
    ]);

    expect(good.status === 'fulfilled' && good.value).toEqual({
      name: 'Deploy Bot',
      avatarUrl: undefined,
      deleted: false,
    });
    expect(bad.status === 'rejected' && bad.reason.message).toBe(
      'Invalid bot id'
    );
    expect(getBotOwnerProfiles.mock.calls).toEqual([[{ ids: [DEPLOY_BOT] }]]);
  });

  it('rejects every waiter when the request fails', async () => {
    getBotOwnerProfiles.mockResolvedValue(
      err([{ code: 'HTTP_ERROR', message: 'bot profiles unavailable' }])
    );

    const results = await Promise.allSettled([
      botProfileLoader.load(DEPLOY_BOT),
      botProfileLoader.load(TRIAGE_BOT),
    ]);

    expect(
      results.map((result) =>
        result.status === 'rejected' ? result.reason.message : result.status
      )
    ).toEqual(['bot profiles unavailable', 'bot profiles unavailable']);
  });
});
