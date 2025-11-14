// onboarding.test.ts
import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { ok } from '@core/util/maybeResult';
import { Link } from '@service-email/generated/schemas';

// Mock window.open and window.location
global.window.open = vi.fn();

// Mock window.location.href
delete (window as any).location;
(window as any).location = { href: '' };

// Mock localStorage
const localStorageMock = (() => {
  let store: Record<string, string> = {};
  return {
    getItem: vi.fn((key: string) => store[key] || null),
    setItem: vi.fn((key: string, value: string) => {
      store[key] = value;
    }),
    removeItem: vi.fn((key: string) => {
      delete store[key];
    }),
    clear: vi.fn(() => {
      store = {};
    }),
  };
})();
Object.defineProperty(global, 'localStorage', { value: localStorageMock });

// Mock the service clients and dependencies
const mockNavigate = vi.fn();
const mockTrack = vi.fn();
const mockSearchParams = {
  subscriptionSuccess: undefined as string | undefined,
};
const mockUseIsAuthenticated = vi.fn(() => false);
const mockUseLicenseStatus = vi.fn(() => false);

vi.mock('@service-email/client', () => ({
  emailClient: {
    getLinks: vi.fn(),
    init: vi.fn(),
  },
}));

vi.mock('@service-gql/client', () => ({
  updateUserInfo: vi.fn(),
  useLicenseStatus: () => mockUseLicenseStatus,
}));

vi.mock('@core/auth', () => ({
  updateUserAuth: vi.fn(),
  useIsAuthenticated: () => mockUseIsAuthenticated,
}));

vi.mock('@service-stripe/client', () => ({
  stripeServiceClient: {
    createCheckoutSession: vi.fn(),
  },
}));

vi.mock('@solidjs/router', () => ({
  useNavigate: () => mockNavigate,
  useSearchParams: () => [mockSearchParams, vi.fn()],
}));

vi.mock('@coparse/analytics', () => ({
  withAnalytics: () => ({
    track: mockTrack,
    TrackingEvents: {
      ONBOARDING: {
        COMPLETE: 'onboarding.complete',
      },
    },
  }),
}));

vi.mock('@core/util/licenseUpdateBroadcastChannel', () => ({
  licenseChannel: {
    subscribe: vi.fn(),
  },
}));
import { emailClient } from '@service-email/client';
import { updateUserInfo } from '@service-gql/client';
import { updateUserAuth } from '@core/auth';
import { stripeServiceClient } from '@service-stripe/client';
import { licenseChannel } from '@core/util/licenseUpdateBroadcastChannel';
import { renderHook, waitFor } from '@solidjs/testing-library';
import { useOnboarding } from './onboarding';

const FAKE_LINK: Link = {
  created_at: '2023-01-01T00:00:00.000Z',
  email_address: 'test@example.com',
  fusionauth_user_id: '123',
  id: '1',
  is_sync_active: true,
  macro_id: '123',
  provider: 'Gmail',
  updated_at: '2023-01-01T00:00:00.000Z',
};

const FAKE_USER_INFO: Awaited<ReturnType<typeof updateUserInfo>> = ok({
  authenticated: true,
  userId: 'macro|user@macro.com',
  hasTrialed: false,
});

describe('Onboarding Flow', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorageMock.clear();
    mockSearchParams.subscriptionSuccess = undefined;
    mockUseIsAuthenticated.mockReturnValue(false);
    mockUseLicenseStatus.mockReturnValue(false);
    mockNavigate.mockClear();
    mockTrack.mockClear();
    vi.mocked(window.open).mockImplementation(() => {
      // Simulate the auth popup completing
      const channel = new BroadcastChannel('auth');
      setTimeout(() => {
        channel.postMessage({ type: 'login-success' });
      }, 0);
      return null;
    });
  });

  afterEach(() => {
    vi.clearAllTimers();
  });

  test('Scenario 1: Unauthenticated -> Auth -> Subscribe -> Redirect', async () => {
    // Setup: User is not authenticated and not subscribed
    mockUseIsAuthenticated.mockReturnValue(false);
    mockUseLicenseStatus.mockReturnValue(false);
    localStorage.setItem('new_user_onboarding', 'true');

    // Mock auth flow
    vi.mocked(emailClient.getLinks).mockResolvedValue(
      ok({ links: [FAKE_LINK] })
    );
    vi.mocked(emailClient.init).mockResolvedValue(ok({}));
    vi.mocked(updateUserAuth).mockResolvedValue(undefined);
    vi.mocked(updateUserInfo).mockResolvedValue(FAKE_USER_INFO);

    // Mock subscription flow
    vi.mocked(stripeServiceClient.createCheckoutSession).mockResolvedValue(
      'https://checkout.stripe.com/test'
    );

    const { result } = renderHook(() => useOnboarding());

    // Initial state: needs auth
    expect(result.onboardingState()).toEqual({
      step: 'needs_auth',
      authenticating: false,
    });
    expect(result.progress()).toBe(0);

    const authPromise = result.signUpAndConnectEmail();
    await authPromise;
    console.log('authPromise done');

    // Should now need subscription
    await waitFor(() => {
      expect(result.onboardingState().step).toBe('needs_subscription');
      expect(result.progress()).toBe(50);
    });

    // Start checkout
    const checkoutPromise = result.checkout();

    // Wait a bit for the license callback to fire
    await new Promise((resolve) => setTimeout(resolve, 50));

    await checkoutPromise;

    console.log('checkoutPromise done');

    // Should complete and redirect
    await waitFor(() => {
      expect(result.onboardingState()).toEqual({ step: 'complete' });
      expect(result.progress()).toBe(100);
      expect(mockNavigate).toHaveBeenCalled();
      expect(mockTrack).toHaveBeenCalledWith('onboarding.complete');
      expect(localStorage.getItem('new_user_onboarding')).toBeNull();
    });
  });

  test('Scenario 2: Already authenticated -> Subscribe -> Redirect', async () => {
    // Setup: User is authenticated but not subscribed
    mockUseIsAuthenticated.mockReturnValue(true);
    mockUseLicenseStatus.mockReturnValue(false);
    localStorage.setItem('new_user_onboarding', 'true');

    vi.mocked(stripeServiceClient.createCheckoutSession).mockResolvedValue(
      'https://checkout.stripe.com/test'
    );
    vi.mocked(updateUserInfo).mockResolvedValue(FAKE_USER_INFO);
    vi.mocked(emailClient.init).mockResolvedValue(ok({}));

    vi.mocked(licenseChannel.subscribe).mockImplementation((cb) => {
      setTimeout(() => cb(), 0);
      return vi.fn();
    });

    const { result } = renderHook(() => useOnboarding());

    await waitFor(() => {
      expect(result.onboardingState()).toEqual({
        step: 'needs_subscription',
        subscribing: false,
      });
      expect(result.progress()).toBe(50);
    });

    const checkoutPromise = result.checkout();

    await new Promise((resolve) => setTimeout(resolve, 50));

    await checkoutPromise;

    // After checkout completes, should complete and redirect
    await waitFor(() => {
      expect(result.onboardingState()).toEqual({ step: 'complete' });
      expect(result.progress()).toBe(100);
      expect(mockNavigate).toHaveBeenCalled();
      expect(mockTrack).toHaveBeenCalledWith('onboarding.complete');
    });
  });

  test('Scenario 3: Unauthenticated -> Auth -> Already subscribed -> Redirect', async () => {
    // Setup: User is not authenticated and not subscribed
    mockUseIsAuthenticated.mockReturnValue(false);
    mockUseLicenseStatus.mockReturnValue(false);
    localStorage.setItem('new_user_onboarding', 'true');

    // Mock auth flow
    vi.mocked(emailClient.getLinks).mockResolvedValue(
      ok({ links: [FAKE_LINK] })
    );
    vi.mocked(emailClient.init).mockResolvedValue(ok({}));
    vi.mocked(updateUserAuth).mockResolvedValue(undefined);
    vi.mocked(updateUserInfo).mockResolvedValue(FAKE_USER_INFO);

    // Mock subscription flow
    vi.mocked(stripeServiceClient.createCheckoutSession).mockResolvedValue(
      'https://checkout.stripe.com/test'
    );

    // Mock license channel subscription - trigger immediately
    vi.mocked(licenseChannel.subscribe).mockImplementation((cb) => {
      setTimeout(() => cb(), 0);
      return vi.fn();
    });

    const { result } = renderHook(() => useOnboarding());

    // Initial state: needs auth
    expect(result.onboardingState()).toEqual({
      step: 'needs_auth',
      authenticating: false,
    });
    expect(result.progress()).toBe(0);

    const authPromise = result.signUpAndConnectEmail();
    await authPromise;

    // Should now need subscription
    await waitFor(() => {
      expect(result.onboardingState().step).toBe('needs_subscription');
      expect(result.progress()).toBe(50);
    });

    // Start checkout
    const checkoutPromise = result.checkout();

    // Wait a bit for the license callback to fire
    await new Promise((resolve) => setTimeout(resolve, 50));

    await checkoutPromise;

    // Should complete and redirect
    await waitFor(() => {
      expect(result.onboardingState()).toEqual({ step: 'complete' });
      expect(result.progress()).toBe(100);
      expect(mockNavigate).toHaveBeenCalled();
      expect(mockTrack).toHaveBeenCalledWith('onboarding.complete');
      expect(localStorage.getItem('new_user_onboarding')).toBeNull();
    });
  });

  test('Scenario 4: Already authenticated and subscribed -> Immediate Redirect', async () => {
    // Setup: User is authenticated and subscribed
    mockUseIsAuthenticated.mockReturnValue(true);
    mockUseLicenseStatus.mockReturnValue(true);
    localStorage.setItem('new_user_onboarding', 'true');

    vi.mocked(emailClient.init).mockResolvedValue(ok({}));

    const { result } = renderHook(() => useOnboarding());

    await waitFor(() => {
      expect(result.onboardingState()).toEqual({ step: 'complete' });
      expect(result.progress()).toBe(100);
      expect(mockNavigate).toHaveBeenCalled();
      expect(mockTrack).toHaveBeenCalledWith('onboarding.complete');
      expect(localStorage.getItem('new_user_onboarding')).toBeNull();
    });
  });
});
