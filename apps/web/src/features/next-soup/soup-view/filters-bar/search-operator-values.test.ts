import { createRoot } from 'solid-js';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@core/context/quickAccess', () => ({
  useQuickAccess: () => ({
    useList: (...buckets: string[]) => ({
      items: () =>
        [
          { bucket: 'channel', data: { name: 'Launch' } },
          { bucket: 'dm', data: { name: 'Ana Lima' } },
        ].filter((item) => buckets.includes(item.bucket)),
    }),
  }),
}));
vi.mock('@queries/contacts/recipient-source', () => ({
  useContactRecipientSource: () => ({ items: () => [] }),
}));
vi.mock('@queries/email/mail-accounts', () => ({
  useMailAccountsQuery: () => ({}),
}));
vi.mock('@queries/gate', () => ({ queryReadyGate: () => false }));
vi.mock('./tag-filter-state', () => ({
  createTagOptions: () => ({ options: () => [] }),
}));

const { createSearchOperatorValues } = await import('./search-operator-values');

describe('createSearchOperatorValues', () => {
  it('offers DMs by the names they show, beside channels', () => {
    createRoot((dispose) => {
      const values = createSearchOperatorValues(() => undefined);
      expect(values().channels).toEqual(['Launch', 'Ana Lima']);
      dispose();
    });
  });
});
