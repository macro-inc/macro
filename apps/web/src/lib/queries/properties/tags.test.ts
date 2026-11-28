import { createRoot } from 'solid-js';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const writes = vi.hoisted(() => ({
  session: 1,
  added: vi.fn(),
  ensured: vi.fn(),
  /** Runs while the cache is read for a provisioned set, which it misses. */
  duringCacheRead: undefined as (() => void) | undefined,
}));

vi.mock('@queries/auth/account-scope', () => ({
  queryAccountSession: () => writes.session,
}));

vi.mock('./catalog/writes', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./catalog/writes')>()),
  cachedTagSet: async () => {
    writes.duringCacheRead?.();
    return undefined;
  },
  ensureTagSet: writes.ensured,
  addPropertyOption: writes.added,
}));

import { createTag, useEnsureTagSetMutation } from './tags';

beforeEach(() => {
  writes.session = 1;
  writes.duringCacheRead = undefined;
  writes.added.mockReset();
  writes.ensured.mockReset().mockImplementation(async (scope: string) => {
    // Another login takes over while the set is provisioned.
    writes.session = 2;
    return {
      scope,
      definition: { id: 'def-1' },
      options: [{ displayOrder: 3 }],
    };
  });
});

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

describe('useEnsureTagSetMutation', () => {
  it('provisions under the login session the call began in', async () => {
    writes.duringCacheRead = () => {
      writes.session = 2;
    };
    await createRoot(async (dispose) => {
      await useEnsureTagSetMutation().mutateAsync({ scope: 'user' });
      dispose();
    });
    expect(writes.ensured).toHaveBeenCalledWith('user', { session: 1 });
  });
});
