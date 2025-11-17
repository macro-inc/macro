import { ok } from '@core/util/maybeResult';
import type { Link } from '@service-email/generated/schemas';
import { mockBroadcastChannel, mockLocalStorage } from '@testing-utils';
import { beforeEach, describe, expect, test, vi } from 'vitest';

global.window.open = vi.fn();

delete (window as any).location;
(window as any).location = { href: '' };

const localStorageMock = mockLocalStorage();

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

import { updateUserAuth } from '@core/auth';
import { licenseChannel } from '@core/util/licenseUpdateBroadcastChannel';
import { emailClient } from '@service-email/client';
import { updateUserInfo } from '@service-gql/client';
import { stripeServiceClient } from '@service-stripe/client';
import { renderHook, waitFor } from '@solidjs/testing-library';
import { getOrCreateAuthChannel } from './email-link';
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

const setupAuthMocks = () => {
  vi.mocked(emailClient.getLinks).mockResolvedValue(ok({ links: [FAKE_LINK] }));
  vi.mocked(emailClient.init).mockResolvedValue(ok({}));
  vi.mocked(updateUserAuth).mockResolvedValue(undefined);
  vi.mocked(updateUserInfo).mockResolvedValue(FAKE_USER_INFO);
};

const setupSubscriptionMocks = () => {
  vi.mocked(stripeServiceClient.createCheckoutSession).mockResolvedValue(
    'https://checkout.stripe.com/test'
  );
};

const setupLicenseMocks = () => {
  vi.mocked(licenseChannel.subscribe).mockImplementation((cb) => {
    setTimeout(() => cb(), 0);
    return vi.fn();
  });
};

describe('Onboarding Flow', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorageMock.clear();
    mockSearchParams.subscriptionSuccess = undefined;
    mockUseIsAuthenticated.mockReturnValue(false);
    mockUseLicenseStatus.mockReturnValue(false);
    mockNavigate.mockClear();
    mockTrack.mockClear();
    mockBroadcastChannel();
    setupAuthMocks();
    setupSubscriptionMocks();
    setupLicenseMocks();
    vi.mocked(window.open).mockImplementation(() => {
      queueMicrotask(() => {
        getOrCreateAuthChannel().postMessage({ type: 'login-success' });
      });
      return null;
    });
  });

  test('Scenario 1: Unauthenticated -> Auth -> Subscribe -> Redirect', async () => {
    // Setup: User is not authenticated and not subscribed
    mockUseIsAuthenticated.mockReturnValue(false);
    mockUseLicenseStatus.mockReturnValue(false);
    localStorage.setItem('new_user_onboarding', 'true');
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

  test('Scenario 2: Already authenticated -> Subscribe -> Redirect', async () => {
    // Setup: User is authenticated but not subscribed
    mockUseIsAuthenticated.mockReturnValue(true);
    mockUseLicenseStatus.mockReturnValue(false);
    localStorage.setItem('new_user_onboarding', 'true');
    const { result } = renderHook(() => useOnboarding());

    await waitFor(() => {
      expect(result.onboardingState()).toEqual({
        step: 'needs_subscription',
        subscribing: false,
      });
      expect(result.progress()).toBe(50);
    });

    const checkoutPromise = result.checkout();

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
