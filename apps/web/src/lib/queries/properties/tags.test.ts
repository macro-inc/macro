import { describe, expect, it, vi } from 'vitest';

const writes = vi.hoisted(() => ({
  session: 1,
  added: vi.fn(),
}));

vi.mock('@queries/auth/account-scope', () => ({
  queryAccountSession: () => writes.session,
}));

vi.mock('./catalog/writes', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./catalog/writes')>()),
  cachedTagSet: async () => undefined,
  // Another login takes over while the set is provisioned.
  ensureTagSet: async (scope: string) => {
    writes.session = 2;
    return {
      scope,
      definition: { id: 'def-1' },
      options: [{ displayOrder: 3 }],
    };
  },
  addPropertyOption: writes.added,
}));

import { createTag } from './tags';

describe('createTag', () => {
  it('adds the tag under the login session it began in', async () => {
    writes.added.mockResolvedValue({ id: 'opt-1' });
    await createTag({ scope: 'user', value: 'Lead', color: '#f00' });
    expect(writes.added).toHaveBeenCalledWith(
      'def-1',
      {
        type: 'select_string',
        option: { value: 'Lead', color: '#f00', display_order: 4 },
      },
      { session: 1 }
    );
  });
});
