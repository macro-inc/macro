import { ok } from 'neverthrow';
import { expect, it, vi } from 'vitest';
import { loadDatabase } from './load-database';

const get = vi.hoisted(() => vi.fn());
vi.mock('@service-storage/client', () => ({
  storageServiceClient: { databases: { get } },
}));

it('gives the block the viewer grant as its access level', async () => {
  get.mockResolvedValue(
    ok({
      database: {
        id: 'database-id',
        name: 'Guests',
        owner_id: 'owner',
        created_at: '2026-09-30T00:00:00Z',
        trashed_at: null,
      },
      grant: 'owner',
      tables: [],
    })
  );
  const result = await loadDatabase('database-id');
  expect(result._unsafeUnwrap().userAccessLevel).toBe('owner');
  expect(get).toHaveBeenCalledWith({ id: 'database-id' });
});
