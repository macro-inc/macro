import { ok } from 'neverthrow';
import { createRoot } from 'solid-js';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@app/lib/analytics/analytics-context', () => ({
  useAnalytics: () => ({}),
}));
vi.mock('@core/email-link', () => ({
  useEmailLinks: () => ({ initEmailLink: () => ok(undefined) }),
}));
vi.mock('@core/context/user', () => ({ deriveIsAuthenticated: () => true }));
vi.mock('@core/util/fetchWithToken', () => ({ unsetTokenPromise: vi.fn() }));
vi.mock('@queries/auth', () => ({ useSendMobileWelcomeEmail: () => ({}) }));
vi.mock('@queries/auth/user-info', () => ({
  useUserInfoQuery: () => ({
    isLoading: false,
    isError: false,
    data: { userId: 'test-user', tutorialComplete: true },
  }),
  invalidateAllAfterLogin: async () => {},
}));
vi.mock('@queries/gate', () => ({ queryReadyGate: () => true }));
vi.mock('./queries/auth-requests', () => ({
  exchangeSessionCode: async () => false,
  sendEmailCode: vi.fn(),
  verifyEmailCode: vi.fn(),
}));
vi.mock('./useSsoLogin', () => ({ useSsoLogin: () => vi.fn() }));

import { createAppAuthContext } from './create-app-auth-context';

describe('interactive reauthentication', () => {
  it('keeps an existing session behind fresh login until credentials are verified', async () => {
    const [context, dispose] = createRoot(
      (dispose) =>
        [createAppAuthContext({ requireFreshLogin: true }), dispose] as const
    );
    try {
      expect(context.session().t).toBe('signed-out');
      expect(await context.redeemSessionToken('rejected-code')).toBe(false);
      expect(context.session().t).toBe('signed-out');
      await context.completeLogin();
      expect(context.session().t).toBe('signed-in');
    } finally {
      dispose();
    }
  });
});
