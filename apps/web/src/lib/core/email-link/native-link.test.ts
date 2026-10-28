import { err, ok } from 'neverthrow';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  choose: vi.fn(),
  start: vi.fn(),
  startOutlook: vi.fn(),
  authenticate: vi.fn(),
  provision: vi.fn(),
  refetch: vi.fn(),
  success: vi.fn(),
  failure: vi.fn(),
  desktop: false,
  mobile: true,
  openDesktop: vi.fn(),
  paywall: vi.fn(),
}));

vi.mock('@app/constants/routerBase', () => ({
  ROUTER_BASE_CONCAT: '/app/',
  toBaseRelative: (value: string) => value.replace(/^\/app/, ''),
}));
vi.mock('@core/auth', () => ({ updateUserAuth: vi.fn() }));
vi.mock('@core/auth/native-auth', () => ({
  openDesktopAuthSession: mocks.openDesktop,
  createNativeAuthSession: () => ({
    callbackUrl: 'macro://android-auth/test-attempt',
    authenticate: mocks.authenticate,
  }),
}));
vi.mock('@core/component/Toast/Toast', () => ({
  toast: { success: mocks.success, failure: mocks.failure },
}));
vi.mock('@core/constant/PaywallState', () => ({
  PaywallKey: { MULTI_INBOX: 'multi-inbox' },
  usePaywallState: () => ({ showPaywall: mocks.paywall }),
}));
vi.mock('@core/mobile/isNativeMobilePlatform', () => ({
  isNativeMobilePlatform: () => mocks.mobile,
}));
vi.mock('@core/util/platform', () => ({
  isPlatform: () => mocks.desktop,
}));
vi.mock('@queries/auth', () => ({
  useInitGmailLink: () => ({ mutateAsync: mocks.start }),
}));
vi.mock('@queries/auth/outlook-link', () => ({
  useInitOutlookLink: () => ({ mutateAsync: mocks.startOutlook }),
}));
vi.mock('@queries/auth/user-info', () => ({ invalidateUserInfo: vi.fn() }));
vi.mock('@queries/email/link', () => ({
  invalidateEmailLinks: vi.fn(),
  useEmailLinksQuery: () => ({ refetch: mocks.refetch }),
}));
vi.mock('@service-email/client', () => ({
  emailClient: { init: mocks.provision },
  ALREADY_INITIALIZED_CODE: 'ALREADY_INITIALIZED',
  NO_GMAIL_GRANT_CODE: 'NO_GMAIL_GRANT',
  SHARED_INBOX_CONFLICT_CODE: 'SHARED_INBOX_CONFLICT',
}));
vi.mock('./share-conflict', () => ({ requestShareInboxConfirmation: vi.fn() }));

vi.mock('./ProviderDialog', () => ({ selectEmailProvider: mocks.choose }));

import { useAddInboxFlow } from './index';
import { consumeInboxLinkReturn } from './return-layout';

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  mocks.desktop = false;
  mocks.mobile = true;
  mocks.openDesktop.mockResolvedValue({ success: true });
  sessionStorage.clear();
  vi.stubGlobal('window', {
    location: {
      origin: 'http://tauri.localhost',
      pathname: '/app/home/~/settings/connections',
      search: '?view=all',
      hash: '#selection',
      href: 'http://tauri.localhost/app/home/~/settings/connections?view=all#selection',
    },
  });
  mocks.start.mockResolvedValue(
    ok({
      link_id: 'pending-link',
      authorization_url: 'https://accounts.google.com/authorize',
    })
  );
  mocks.authenticate.mockResolvedValue({ success: true });
  mocks.provision.mockResolvedValue(ok(undefined));
  mocks.refetch.mockResolvedValue(undefined);
});

afterEach(() => {
  vi.runOnlyPendingTimers();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('desktop account linking', () => {
  beforeEach(() => {
    mocks.mobile = false;
    mocks.desktop = true;
  });

  it.each(['gmail', 'calendar', 'gmail_and_calendar'] as const)(
    'opens %s consent in the system browser with an inbox callback',
    async (scopes) => {
      const originalLocation = window.location.href;
      await useAddInboxFlow()({
        scopes,
        provider: 'GMAIL',
        emailAddress: 'second@example.com',
      });
      expect(mocks.start).toHaveBeenCalledExactlyOnceWith({
        originalUrl: 'macro:///inbox-link-callback',
        scopes,
      });
      expect(mocks.openDesktop).toHaveBeenCalledExactlyOnceWith(
        'https://accounts.google.com/authorize?login_hint=second%40example.com'
      );
      expect(consumeInboxLinkReturn('pending-link')).toEqual({
        url: '/home/~/settings/connections?view=all#selection',
      });
      expect(window.location.href).toBe(originalLocation);
      expect(mocks.authenticate).not.toHaveBeenCalled();
      expect(mocks.provision).not.toHaveBeenCalled();
      expect(mocks.success).not.toHaveBeenCalled();
    }
  );

  it.each(['gmail', 'calendar', 'gmail_and_calendar'] as const)(
    'opens Outlook %s reconnect in the system browser with an inbox callback',
    async (scopes) => {
      mocks.startOutlook.mockResolvedValue(
        ok({
          link_id: 'outlook-link',
          authorization_url:
            'https://login.microsoftonline.com/common/authorize',
        })
      );
      const originalLocation = window.location.href;
      await useAddInboxFlow()({
        scopes,
        provider: 'OUTLOOK',
        reconnectLinkId: 'existing-outlook-link',
        emailAddress: 'second@example.com',
      });
      expect(mocks.start).not.toHaveBeenCalled();
      expect(mocks.startOutlook).toHaveBeenCalledExactlyOnceWith({
        originalUrl: 'macro:///inbox-link-callback',
        calendar: scopes !== 'gmail',
        reconnectLinkId: 'existing-outlook-link',
      });
      expect(mocks.openDesktop).toHaveBeenCalledExactlyOnceWith(
        'https://login.microsoftonline.com/common/authorize?login_hint=second%40example.com'
      );
      expect(consumeInboxLinkReturn('outlook-link')).toEqual({
        url: '/home/~/settings/connections?view=all#selection',
      });
      expect(window.location.href).toBe(originalLocation);
      expect(mocks.authenticate).not.toHaveBeenCalled();
      expect(mocks.provision).not.toHaveBeenCalled();
    }
  );

  it('reports a browser launch failure without provisioning the inbox', async () => {
    mocks.openDesktop.mockResolvedValue({ success: false });
    await useAddInboxFlow()({ provider: 'GMAIL' });
    expect(mocks.failure).toHaveBeenCalledWith(
      'Failed to open the browser to connect your account. Please try again.'
    );
    expect(mocks.provision).not.toHaveBeenCalled();
  });

  it.each(['PAYMENT_REQUIRED', 'TOO_MANY_PENDING_LINKS'])(
    'does not open consent when the backend returns %s',
    async (code) => {
      mocks.start.mockResolvedValue(err([{ code }]));
      await useAddInboxFlow()({ provider: 'GMAIL' });
      expect(mocks.openDesktop).not.toHaveBeenCalled();
      expect(mocks.provision).not.toHaveBeenCalled();
      if (code === 'PAYMENT_REQUIRED') {
        expect(mocks.paywall).toHaveBeenCalledWith('multi-inbox');
      } else {
        expect(mocks.failure).toHaveBeenCalledWith(
          'Too many inbox connections in progress.'
        );
      }
    }
  );
});

it('keeps web consent on the originating host', async () => {
  mocks.mobile = false;
  vi.stubGlobal('window', {
    location: { ...window.location, origin: 'https://www.macro.com' },
  });
  await useAddInboxFlow()({ provider: 'GMAIL' });
  expect(mocks.start).toHaveBeenCalledWith({
    originalUrl: 'https://www.macro.com/app/inbox-link-callback',
    scopes: 'gmail',
  });
  expect(window.location.href).toBe('https://accounts.google.com/authorize');
  expect(mocks.openDesktop).not.toHaveBeenCalled();
});

describe('native account linking', () => {
  it.each(['gmail', 'calendar'] as const)(
    'completes %s consent without requiring a login session token',
    async (scopes) => {
      await useAddInboxFlow()({ scopes, provider: 'GMAIL' });
      expect(mocks.start).toHaveBeenCalledWith({
        originalUrl: 'macro://android-auth/test-attempt',
        scopes,
      });
      expect(mocks.authenticate).toHaveBeenCalledWith(
        'https://accounts.google.com/authorize'
      );
      expect(mocks.provision).toHaveBeenCalledWith({
        linkId: 'pending-link',
        forceShare: false,
      });
      expect(mocks.refetch).toHaveBeenCalledOnce();
      expect(mocks.success).toHaveBeenCalledWith('Account connected');
      expect(mocks.failure).not.toHaveBeenCalled();
    }
  );

  it.each(['gmail', 'calendar'] as const)(
    'completes Outlook %s consent with the same native callback',
    async (scopes) => {
      mocks.startOutlook.mockResolvedValue(
        ok({
          link_id: 'outlook-link',
          authorization_url:
            'https://login.microsoftonline.com/common/authorize',
        })
      );
      await useAddInboxFlow()({ scopes, provider: 'OUTLOOK' });
      expect(mocks.start).not.toHaveBeenCalled();
      expect(mocks.startOutlook).toHaveBeenCalledWith({
        originalUrl: 'macro://android-auth/test-attempt',
        calendar: scopes === 'calendar',
      });
      expect(mocks.provision).toHaveBeenCalledWith({
        linkId: 'outlook-link',
        forceShare: false,
      });
    }
  );

  it('does not provision an inbox after consent is canceled', async () => {
    mocks.authenticate.mockResolvedValue({
      success: false,
      error: 'User canceled login',
    });
    await useAddInboxFlow()({ provider: 'GMAIL' });
    expect(mocks.provision).not.toHaveBeenCalled();
    expect(mocks.refetch).not.toHaveBeenCalled();
    expect(mocks.failure).not.toHaveBeenCalled();
  });
});

it('uses the provider selected from a generic connect entry point', async () => {
  mocks.choose.mockResolvedValue('OUTLOOK');
  mocks.startOutlook.mockResolvedValue(
    ok({
      link_id: 'selected-outlook',
      authorization_url: 'https://login.microsoftonline.com/common/authorize',
    })
  );
  await useAddInboxFlow()();
  expect(mocks.start).not.toHaveBeenCalled();
  expect(mocks.startOutlook).toHaveBeenCalledOnce();
  expect(mocks.provision).toHaveBeenCalledWith({
    linkId: 'selected-outlook',
    forceShare: false,
  });
});
it('does not create an OAuth attempt when provider selection is canceled', async () => {
  mocks.choose.mockResolvedValue(undefined);
  await useAddInboxFlow()();
  expect(mocks.start).not.toHaveBeenCalled();
  expect(mocks.startOutlook).not.toHaveBeenCalled();
  expect(mocks.authenticate).not.toHaveBeenCalled();
});
