import { createRoot } from 'solid-js';
import { describe, expect, it, vi } from 'vitest';

const items = [
  { bucket: 'channel', id: 'launch', data: { name: 'Launch' } },
  { bucket: 'dm', id: 'dm-ana', data: { name: 'Ana Lima' } },
];

vi.mock('@core/context/quickAccess', () => ({
  useQuickAccess: () => ({
    useList: (...buckets: string[]) => ({
      items: () => items.filter((item) => buckets.includes(item.bucket)),
    }),
  }),
}));
vi.mock('@core/context/user', () => ({
  useUserId: () => () => 'macro|viewer@example.com',
}));
vi.mock('@queries/email/mail-accounts', () => ({
  useMailAccountsQuery: () => ({}),
}));
vi.mock('@queries/gate', () => ({ queryReadyGate: () => false }));

const { createSearchOperatorLookup } = await import('./search-operator-lookup');

describe('createSearchOperatorLookup', () => {
  it('reaches a DM by the name the channel list shows for it', () => {
    createRoot((dispose) => {
      const lookup = createSearchOperatorLookup({
        options: () => [],
        defByOption: () => new Map(),
      });
      expect(lookup().channels('ana lima')).toEqual(['dm-ana']);
      expect(lookup().channels('Launch')).toEqual(['launch']);
      dispose();
    });
  });
});
