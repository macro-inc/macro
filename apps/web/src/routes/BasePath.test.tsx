/**
 * @vitest-environment jsdom
 */

import { DEFAULT_ROUTE } from '@app/constants/defaultRoute';
import { ThrownResultError } from '@core/util/result';
import { QueryClientProvider } from '@tanstack/solid-query';
import type { JSX } from 'solid-js';
import { render } from 'solid-js/web';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  clearLocalAuthSession: vi.fn(),
  confirmSessionExpired: vi.fn(),
  fetchUserInfo: vi.fn(),
  hasLoginCookie: true,
  nativeMobile: false,
  navigate: vi.fn(),
}));

vi.mock('@app/features/paywall/use-checkout-completion-listener', () => ({
  useCheckoutCompletionListener: () => () => false,
}));

vi.mock('@core/auth/logout', () => ({
  clearLocalAuthSession: mocks.clearLocalAuthSession,
}));

vi.mock('@core/mobile/isNativeMobilePlatform', () => ({
  isNativeMobilePlatform: () => mocks.nativeMobile,
}));

vi.mock('@core/util/cookies', () => ({
  hasLoginCookie: () => mocks.hasLoginCookie,
}));

vi.mock('@core/util/fetchWithToken', () => ({
  confirmSessionExpired: mocks.confirmSessionExpired,
}));

// A single client instance shared with the component under test: the
// SessionExpiredRedirect confirm path reads the refetched query error straight
// off this client, so the mock must hand both sides the same cache.
vi.mock('@queries/client', async () => {
  const { QueryClient } = await import('@tanstack/solid-query');
  return {
    queryClient: new QueryClient({
      defaultOptions: { queries: { retry: false } },
    }),
  };
});

// Thin re-implementation of the user-info query over the mocked client, so the
// test controls fetch outcomes while keeping real query semantics (error
// state, invalidation-triggered refetches).
vi.mock('@queries/auth/user-info', async () => {
  const { useQuery } = await import('@tanstack/solid-query');
  const { queryClient } = await import('@queries/client');
  const authKeys = { userInfo: { queryKey: ['auth', 'userInfo'] } };
  return {
    authKeys,
    invalidateUserInfo: () =>
      queryClient.invalidateQueries({ queryKey: authKeys.userInfo.queryKey }),
    useUserInfoQuery: () =>
      useQuery(() => ({
        queryKey: authKeys.userInfo.queryKey,
        queryFn: mocks.fetchUserInfo,
        networkMode: 'always',
      })),
  };
});

vi.mock('@solidjs/router', () => ({
  // Mirrors the real Navigate component: a replace navigation on render.
  Navigate: (props: { href: string }) => {
    mocks.navigate(props.href, { replace: true });
    return null;
  },
  useSearchParams: () => [{}, () => {}],
}));

vi.mock('@ui', () => ({
  Button: (props: { children: JSX.Element; onClick?: () => void }) => (
    <button onClick={props.onClick}>{props.children}</button>
  ),
}));

import { queryClient } from '@queries/client';
import { BasePathComponent } from './BasePath';

const UNAUTHORIZED_ERROR = () =>
  new ThrownResultError([
    { code: 'UNAUTHORIZED', message: 'Unauthorized access' },
  ]);

const SERVER_ERROR = () =>
  new ThrownResultError([
    { code: 'SERVER_ERROR', message: 'Internal server error' },
  ]);

let dispose: (() => void) | undefined;

function renderRoute(): HTMLElement {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const disposeRender = render(
    () => (
      <QueryClientProvider client={queryClient}>
        <BasePathComponent />
      </QueryClientProvider>
    ),
    container
  );
  dispose = () => {
    disposeRender();
    container.remove();
  };
  return container;
}

/** Lets in-flight query/resource promises settle before negative assertions. */
function flush() {
  return new Promise((resolve) => setTimeout(resolve, 25));
}

beforeEach(() => {
  mocks.hasLoginCookie = true;
  mocks.nativeMobile = false;
  mocks.navigate.mockReset();
  mocks.fetchUserInfo.mockReset();
  mocks.confirmSessionExpired.mockReset();
  mocks.clearLocalAuthSession.mockReset();
  mocks.clearLocalAuthSession.mockResolvedValue(undefined);
  sessionStorage.clear();
  queryClient.clear();
  window.history.replaceState({}, '', '/app/');
});

afterEach(() => {
  dispose?.();
  dispose = undefined;
});

describe('BasePathComponent', () => {
  it('redirects an authenticated session to the default route', async () => {
    mocks.fetchUserInfo.mockResolvedValue({ authenticated: true });

    renderRoute();

    await vi.waitFor(() => {
      expect(mocks.navigate).toHaveBeenCalledWith(DEFAULT_ROUTE, {
        replace: true,
      });
    });
  });

  it('redirects a session without a login cookie to welcome', async () => {
    mocks.hasLoginCookie = false;
    mocks.fetchUserInfo.mockResolvedValue({ authenticated: false });

    renderRoute();

    await vi.waitFor(() => {
      expect(mocks.navigate).toHaveBeenCalledWith('/welcome', {
        replace: true,
      });
    });
    expect(mocks.confirmSessionExpired).not.toHaveBeenCalled();
  });

  it('clears the session and redirects on a confirmed expiry', async () => {
    mocks.fetchUserInfo.mockRejectedValue(UNAUTHORIZED_ERROR());
    mocks.confirmSessionExpired.mockResolvedValue(true);

    renderRoute();

    await vi.waitFor(() => {
      expect(mocks.clearLocalAuthSession).toHaveBeenCalled();
      expect(mocks.navigate).toHaveBeenCalledWith('/welcome', {
        replace: true,
      });
    });
  });

  it('keeps a cookie-backed session off welcome when the confirm refresh fails transiently', async () => {
    // A latched refresh failure surfaced UNAUTHORIZED, but the confirming
    // refresh says the session is alive — and the user-info refetch then hits
    // a transient server failure. The query settles into a non-UNAUTHORIZED
    // error: "unknown", not "unauthenticated".
    mocks.fetchUserInfo
      .mockRejectedValueOnce(UNAUTHORIZED_ERROR())
      .mockRejectedValue(SERVER_ERROR());
    mocks.confirmSessionExpired.mockResolvedValue(false);

    const container = renderRoute();

    await vi.waitFor(() => {
      expect(mocks.confirmSessionExpired).toHaveBeenCalled();
      expect(mocks.fetchUserInfo).toHaveBeenCalledTimes(2);
    });
    await flush();

    // The local session survives and the unknown state renders nothing
    // instead of bouncing a possibly-valid session to login.
    expect(mocks.clearLocalAuthSession).not.toHaveBeenCalled();
    expect(mocks.navigate).not.toHaveBeenCalled();
    expect(container.textContent).toBe('');
  });

  it('asks native users to verify their session when no local identity is available', async () => {
    mocks.nativeMobile = true;
    mocks.fetchUserInfo.mockRejectedValue(SERVER_ERROR());

    const container = renderRoute();

    await vi.waitFor(() => {
      expect(container.textContent).toContain('Unable to connect.');
    });
    expect(mocks.navigate).not.toHaveBeenCalled();
  });

  it('enters the native app with a cached identity when its refresh fails', async () => {
    mocks.nativeMobile = true;
    mocks.fetchUserInfo.mockRejectedValue(SERVER_ERROR());
    queryClient.setQueryData(['auth', 'userInfo'], { authenticated: true });

    const container = renderRoute();

    await vi.waitFor(() => {
      expect(mocks.navigate).toHaveBeenCalledWith(DEFAULT_ROUTE, {
        replace: true,
      });
    });
    await flush();

    expect(container.textContent).not.toContain('Unable to connect.');
  });

  it('enters the app after session verification succeeds', async () => {
    mocks.nativeMobile = true;
    mocks.fetchUserInfo
      .mockRejectedValueOnce(SERVER_ERROR())
      .mockResolvedValue({ authenticated: true });

    const container = renderRoute();

    await vi.waitFor(() => {
      expect(container.textContent).toContain('Unable to connect.');
    });

    container.querySelector('button')?.click();

    await vi.waitFor(() => {
      expect(mocks.navigate).toHaveBeenCalledWith(DEFAULT_ROUTE, {
        replace: true,
      });
    });
  });
});
