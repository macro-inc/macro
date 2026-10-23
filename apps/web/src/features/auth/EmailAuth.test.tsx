import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@solidjs/testing-library';
import { errAsync, okAsync, ResultAsync } from 'neverthrow';
import type { JSX } from 'solid-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  navigate: vi.fn(),
  init: vi.fn(),
  refetch: vi.fn(),
  failure: vi.fn(),
  success: vi.fn(),
  linkId: 'oauth-link',
  searchParams: {} as Record<string, string>,
  restore: vi.fn(),
  track: vi.fn(),
  openAddInbox: vi.fn(),
  fetchProviders: vi.fn(),
}));
vi.mock('@solidjs/router', () => ({
  useNavigate: () => mocks.navigate,
  useSearchParams: () => [mocks.searchParams],
}));
vi.mock('@app/features/inbox/AddInboxDialog', () => ({
  openAddInboxDialog: mocks.openAddInbox,
}));
vi.mock('@queries/auth/outlook-link', () => ({
  fetchEmailConnectionProviders: mocks.fetchProviders,
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
  toast: { success: mocks.success, failure: mocks.failure },
}));
vi.mock('@core/constant/SettingsState', () => ({
  restoreSettingsReturnTo: vi.fn(),
}));
vi.mock('@core/email-link/return-layout', () => ({
  consumeInboxLinkReturn: mocks.restore,
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
vi.mock('@app/features/inbox/AdminConsentRequiredDialog', () => ({
  AdminConsentRequiredDialog: (props: {
    adminConsentUrl: string | undefined;
    onConnectDifferentAccount: () => void;
    onClose: () => void;
  }) => (
    <div>
      <p>Admin approval required</p>
      <output>{props.adminConsentUrl ?? 'loading'}</output>
      <button onClick={props.onConnectDifferentAccount}>
        Connect a different account
      </button>
      <button onClick={props.onClose}>Close approval</button>
    </div>
  ),
}));
vi.mock('@app/features/inbox/ShareInboxConflictDialog', () => ({
  ShareInboxConflictDialog: (props: {
    onShare: () => void;
    onCancel: () => void;
  }) => (
    <div>
      <button onClick={props.onShare}>Share inbox</button>
      <button onClick={props.onCancel}>Cancel share</button>
    </div>
  ),
}));

import { makeEmailAuthComponents } from './EmailAuth';

const { EmailLinkCallback } = makeEmailAuthComponents({
  callbackPath: '/signup-callback',
  linkCallbackPath: '/inbox-link-callback',
  successPath: '/',
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.linkId = 'oauth-link';
  mocks.searchParams = { link_id: mocks.linkId };
  mocks.fetchProviders.mockResolvedValue({
    gmail: true,
    outlook: true,
    outlook_admin_consent_url:
      'https://login.microsoftonline.com/organizations/v2.0/adminconsent?client_id=app',
  });
  mocks.refetch.mockResolvedValue({});
  mocks.restore.mockReturnValue({ url: '/calendar/week' });
  mocks.init.mockReturnValue(okAsync(undefined));
});
afterEach(cleanup);

describe('inbox consent callback', () => {
  it('applies the grant without waiting for the old inbox query, then restores the calendar', async () => {
    render(() => <EmailLinkCallback />);
    await waitFor(() =>
      expect(mocks.navigate).toHaveBeenCalledWith('/calendar/week', {
        replace: true,
      })
    );
    expect(mocks.init).toHaveBeenCalledExactlyOnceWith({
      linkId: 'oauth-link',
      forceShare: false,
    });
    expect(mocks.refetch).toHaveBeenCalledOnce();
    expect(mocks.track).toHaveBeenCalledExactlyOnceWith(
      'email_link_callback_result',
      { outcome: 'connected' }
    );
  });

  it('explains pending work and lets the user return without a later redirect', async () => {
    let finish!: () => void;
    mocks.init.mockReturnValue(
      ResultAsync.fromSafePromise(
        new Promise<void>((resolve) => {
          finish = resolve;
        })
      )
    );
    const mounted = render(() => <EmailLinkCallback />);
    expect(
      await screen.findByText('Finishing account connection…')
    ).toBeTruthy();
    await fireEvent.click(screen.getByRole('button', { name: 'Back to app' }));
    expect(mocks.navigate).toHaveBeenCalledOnce();
    mounted.unmount();
    finish();
    await waitFor(() => expect(mocks.refetch).toHaveBeenCalledOnce());
    expect(mocks.navigate).toHaveBeenCalledOnce();
  });

  it('leaves the callback and explains an unexpected request failure', async () => {
    mocks.init.mockImplementationOnce(() => {
      throw new Error('network failed');
    });
    render(() => <EmailLinkCallback />);
    await waitFor(() => expect(mocks.failure).toHaveBeenCalledOnce());
    expect(mocks.navigate).toHaveBeenCalledWith('/calendar/week', {
      replace: true,
    });
  });

  it('reports declined permissions without getting stuck', async () => {
    mocks.init.mockReturnValue(errAsync({ tag: 'NoGmailGrant' }));
    render(() => <EmailLinkCallback />);
    await waitFor(() =>
      expect(mocks.failure).toHaveBeenCalledWith(
        expect.stringContaining('Gmail access was not granted')
      )
    );
    expect(mocks.navigate).toHaveBeenCalledOnce();
    expect(mocks.track).toHaveBeenCalledExactlyOnceWith(
      'email_link_callback_result',
      { outcome: 'no_gmail_grant' }
    );
  });

  it('still holds the callback for a shared-inbox confirmation', async () => {
    mocks.init.mockReturnValueOnce(
      errAsync({
        tag: 'SharedInboxConflict',
        emailAddress: 'inbox@example.com',
        ownerEmail: 'owner@example.com',
      })
    );
    render(() => <EmailLinkCallback />);
    await fireEvent.click(
      await screen.findByRole('button', { name: 'Share inbox' })
    );
    await waitFor(() =>
      expect(mocks.init).toHaveBeenLastCalledWith({
        linkId: 'oauth-link',
        forceShare: true,
      })
    );
    await waitFor(() => expect(mocks.navigate).toHaveBeenCalledOnce());
  });
});

describe('consent that ended without a grant', () => {
  it('explains admin approval with the tenant-wide link and never provisions', async () => {
    mocks.searchParams = {
      link_id: 'oauth-link',
      email_link_error: 'admin_consent_required',
      provider: 'outlook',
    };
    render(() => <EmailLinkCallback />);
    expect(await screen.findByText('Admin approval required')).toBeTruthy();
    await waitFor(() =>
      expect(screen.getByRole('status').textContent).toContain(
        'login.microsoftonline.com/organizations/v2.0/adminconsent'
      )
    );
    expect(mocks.init).not.toHaveBeenCalled();
    expect(mocks.navigate).not.toHaveBeenCalled();

    await fireEvent.click(
      screen.getByRole('button', { name: 'Close approval' })
    );
    expect(mocks.navigate).toHaveBeenCalledWith('/calendar/week', {
      replace: true,
    });
    expect(mocks.restore).toHaveBeenCalledWith('oauth-link');
  });

  it('reopens the connect dialog for a different account', async () => {
    mocks.searchParams = {
      link_id: 'oauth-link',
      email_link_error: 'admin_consent_required',
      provider: 'outlook',
    };
    render(() => <EmailLinkCallback />);
    await fireEvent.click(
      await screen.findByRole('button', { name: 'Connect a different account' })
    );
    expect(mocks.openAddInbox).toHaveBeenCalledOnce();
    expect(mocks.navigate).toHaveBeenCalledOnce();
  });

  it('leaves the copy action unavailable when the approval link cannot load', async () => {
    mocks.fetchProviders.mockRejectedValue(new Error('offline'));
    mocks.searchParams = {
      link_id: 'oauth-link',
      email_link_error: 'admin_consent_required',
      provider: 'outlook',
    };
    render(() => <EmailLinkCallback />);
    expect(await screen.findByText('Admin approval required')).toBeTruthy();
    await waitFor(() => expect(mocks.fetchProviders).toHaveBeenCalledOnce());
    expect(screen.getByRole('status').textContent).toBe('loading');
  });

  it('returns quietly when the user cancelled on the consent screen', async () => {
    mocks.searchParams = {
      link_id: 'oauth-link',
      email_link_error: 'cancelled',
      provider: 'outlook',
    };
    render(() => <EmailLinkCallback />);
    await waitFor(() =>
      expect(mocks.navigate).toHaveBeenCalledWith('/calendar/week', {
        replace: true,
      })
    );
    expect(mocks.failure).not.toHaveBeenCalled();
    expect(mocks.init).not.toHaveBeenCalled();
  });

  it('reports any other provider failure and returns', async () => {
    mocks.searchParams = {
      link_id: 'oauth-link',
      email_link_error: 'failed',
      provider: 'outlook',
    };
    render(() => <EmailLinkCallback />);
    await waitFor(() => expect(mocks.failure).toHaveBeenCalledOnce());
    expect(mocks.navigate).toHaveBeenCalledWith('/calendar/week', {
      replace: true,
    });
  });

  it('invites an administrator who just approved the tenant to connect again', async () => {
    mocks.searchParams = {
      email_link_notice: 'admin_consent_granted',
      provider: 'outlook',
    };
    render(() => <EmailLinkCallback />);
    await waitFor(() =>
      expect(mocks.success).toHaveBeenCalledWith(
        'Approved. Try connecting again.'
      )
    );
    expect(mocks.openAddInbox).toHaveBeenCalledOnce();
    expect(mocks.restore).not.toHaveBeenCalled();
    expect(mocks.navigate).toHaveBeenCalledOnce();
  });
});
