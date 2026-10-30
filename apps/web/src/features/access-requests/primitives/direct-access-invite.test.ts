import { createRoot } from 'solid-js';
import { expect, it, vi } from 'vitest';
import type { SharingSource } from '../context/contracts';
import { createDirectAccessInvite } from './direct-access-invite';

it('grants view access by Macro email and preserves the address when the write fails', async () => {
  const setGrant = vi.fn().mockResolvedValue(undefined);
  const state = createRoot((dispose) => {
    const source: SharingSource = {
      state: () => ({
        canReview: true,
        supportedLevels: ['view'],
        requests: [],
        pendingCount: 0,
      }),
      grants: () => [],
      loading: () => false,
      busy: () => false,
      error: () => undefined,
      refresh: async () => undefined,
      submit: async () => undefined,
      cancel: async () => undefined,
      resolve: async () => undefined,
      setGrant,
      nextPage: () => {},
      firstPage: () => {},
    };
    return { invite: createDirectAccessInvite(source), dispose };
  });
  state.invite.setEmail('  Ana@Example.test  ');
  await state.invite.invite();
  expect(setGrant).toHaveBeenCalledWith('macro|ana@example.test', 'view');
  expect(state.invite.email()).toBe('');
  expect(state.invite.notice()).toBe('View access added.');
  setGrant.mockRejectedValueOnce(new Error('not registered'));
  state.invite.setEmail('ben@example.test');
  await state.invite.invite();
  expect(state.invite.email()).toBe('ben@example.test');
  expect(state.invite.error()).toContain("Couldn't add this person");
  state.dispose();
});
