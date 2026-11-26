// @vitest-environment jsdom

import { cleanup, render, waitFor } from '@solidjs/testing-library';
import { okAsync } from 'neverthrow';
import type { JSX } from 'solid-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  listen: vi.fn(),
  invoke: vi.fn(),
  init: vi.fn(),
  refetch: vi.fn(),
  track: vi.fn(),
  failure: vi.fn(),
}));

vi.mock('@tauri-apps/api/event', () => ({ listen: mocks.listen }));
vi.mock('@tauri-apps/api/core', () => ({ invoke: mocks.invoke }));
vi.mock('@app/lib/tauri/macroLinkInterceptor', () => ({
  registerMacroLinkInterceptor: () => () => {},
}));
vi.mock('@core/util/platform', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@core/util/platform')>()),
  getNativeMobilePlatform: () => undefined,
}));
vi.mock('@queries/auth', () => ({ invalidateGithubLinkStatus: vi.fn() }));
vi.mock('@app/features/inbox/AddInboxDialog', () => ({
  openAddInboxDialog: vi.fn(),
}));
vi.mock('@app/features/inbox/AdminConsentRequiredDialog', () => ({
  AdminConsentRequiredDialog: () => null,
}));
vi.mock('@app/features/inbox/ShareInboxConflictDialog', () => ({
  ShareInboxConflictDialog: () => null,
}));
vi.mock('@queries/auth/outlook-link', () => ({
  fetchEmailConnectionProviders: vi.fn(),
}));
vi.mock('@core/email-link', () => ({
  useEmailLinks: () => ({
    query: { isSuccess: false, isError: false, refetch: mocks.refetch },
    initEmailLink: mocks.init,
  }),
}));
vi.mock('@core/auth', () => ({ updateUserAuth: vi.fn() }));
vi.mock('@core/auth/email', () => ({ redirectToEmailAuth: vi.fn() }));
vi.mock('@core/auth/login-events', () => ({ publishLoginSuccess: vi.fn() }));
vi.mock('@app/lib/analytics/analytics-context', () => ({
  useAnalytics: () => ({ pageView: vi.fn(), track: mocks.track }),
}));
vi.mock('@core/component/Toast/Toast', () => ({
  toast: {
    success: vi.fn(),
    failure: mocks.failure,
    alert: vi.fn(),
    custom: vi.fn(),
    dismiss: vi.fn(),
  },
}));
vi.mock('@core/mobile/isMobile', () => ({ isMobile: () => false }));
vi.mock('@core/mobile/isNativeMobilePlatform', () => ({
  isNativeMobilePlatform: () => false,
}));
vi.mock('@queries/auth/user-info', () => ({
  invalidateAllAfterLogin: vi.fn(),
  useUserInfoQuery: () => ({ data: { tutorialComplete: true } }),
}));
vi.mock('@ui', () => ({
  Button: (props: JSX.ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button {...props} />
  ),
}));

import { makeEmailAuthComponents } from '@app/features/auth/EmailAuth';
import {
  createMemoryPaneStore,
  SplitRouter,
  useSolidRouterHistory,
} from '@app/lib/split-router';
import { createTestPolicy } from '@app/lib/split-router/tests/fixtures';
import { useTauriNavigationEffect } from '@app/lib/tauri/navigation';
import { paneRoute } from '@app/routes/app-route';
import {
  appRoute,
  authRoute,
  homeSplitRoute,
  INBOX_LINK_CALLBACK_PATH,
  inboxLinkCallbackRoute,
} from '@app/routes/routes';
import { rememberInboxLinkReturn } from '@core/email-link/return-layout';
import { HashRouter, Router } from '@solidjs/router';

const { EmailLinkCallback } = makeEmailAuthComponents({
  callbackPath: '/email-signup-callback',
  linkCallbackPath: INBOX_LINK_CALLBACK_PATH,
  successPath: '/',
});

const LINK_ID = '0f9c1b9e-2a4d-4c55-9a77-1b2d3c4e5f60';

type NavigatePayload = { path: string; query: string; fragment?: string };
let deliver: (event: { payload: NavigatePayload }) => void;

/** The split router over Solid Router, as `AppRouterView` mounts it. */
function SplitRoutes(props: { base: string; mode: 'hash' | 'path' }) {
  return (
    <SplitRouter.Router
      history={() =>
        useSolidRouterHistory({ base: props.base, mode: props.mode })
      }
      paneStore={createMemoryPaneStore()}
      policy={createTestPolicy().policy}
      defaultRoute={() => paneRoute({ id: homeSplitRoute.id, params: {} })}
    >
      <SplitRouter.Route definition={authRoute}>
        <SplitRouter.Route
          definition={inboxLinkCallbackRoute}
          component={EmailLinkCallback}
        />
      </SplitRouter.Route>
      <SplitRouter.Route definition={appRoute}>
        <SplitRouter.Route
          definition={homeSplitRoute}
          component={() => <p>Home</p>}
        />
      </SplitRouter.Route>
    </SplitRouter.Router>
  );
}

/** The desktop shell: Solid's hash router, the deep-link bridge, the split router. */
function DesktopApp() {
  return (
    <HashRouter
      root={() => {
        useTauriNavigationEffect();
        return <SplitRoutes base="/" mode="hash" />;
      }}
    />
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  sessionStorage.clear();
  mocks.invoke.mockResolvedValue(undefined);
  mocks.listen.mockImplementation(async (_name, handler) => {
    deliver = handler;
    return () => {};
  });
  mocks.refetch.mockResolvedValue({});
  mocks.init.mockReturnValue(okAsync(LINK_ID));
});

afterEach(cleanup);

describe('inbox consent return', () => {
  it('provisions the link a desktop deep link names and returns to the layout', async () => {
    window.history.replaceState(null, '', '/#/home');
    const view = render(() => <DesktopApp />);
    await view.findByText('Home');
    await waitFor(() => expect(mocks.listen).toHaveBeenCalled());
    // What `useAddInboxFlow` stashes before opening the system browser.
    rememberInboxLinkReturn(LINK_ID, { url: '/home', scopes: 'gmail' });

    // What the shell emits for macro:///inbox-link-callback?link_id=<id>&token=<id>,
    // the auth service's redirect (`emit_navigate_for_deep_link` in
    // tauri/src-tauri/src/lib.rs).
    deliver({
      payload: {
        path: '/inbox-link-callback',
        query: `link_id=${LINK_ID}&token=${LINK_ID}`,
      },
    });

    await waitFor(() =>
      expect(mocks.track).toHaveBeenCalledWith('email_link_callback_result', {
        outcome: 'connected',
      })
    );
    expect(mocks.init).toHaveBeenCalledExactlyOnceWith({
      linkId: LINK_ID,
      forceShare: false,
    });
    expect(mocks.failure).not.toHaveBeenCalled();
    await view.findByText('Home');
    await waitFor(() => expect(window.location.hash).toBe('#/home'));
  });

  it('provisions the link a web callback page load names', async () => {
    window.history.replaceState(
      null,
      '',
      `/app/inbox-link-callback?link_id=${LINK_ID}&token=${LINK_ID}`
    );
    render(() => (
      <Router
        base="/app"
        root={() => <SplitRoutes base="/app" mode="path" />}
      />
    ));

    await waitFor(() =>
      expect(mocks.track).toHaveBeenCalledWith('email_link_callback_result', {
        outcome: 'connected',
      })
    );
    expect(mocks.init).toHaveBeenCalledExactlyOnceWith({
      linkId: LINK_ID,
      forceShare: false,
    });
  });
});
