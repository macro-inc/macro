/** @vitest-environment jsdom */
import { HomeEmptyState } from '@app/features/home/components/HomeEmptyState';
import { useAddInboxFlow } from '@core/email-link';
import { Telemetry } from '@macro-inc/observability';
import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import { ImperativeDialogHost } from '@ui';
import { ok } from 'neverthrow';
import { createSignal, Show } from 'solid-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EmailEmptyState } from './EmailEmptyState';

const providers = vi.hoisted(() => vi.fn());
const mail = vi.hoisted(() => ({ discover: vi.fn(), connect: vi.fn() }));
vi.mock('@core/context/user', () => ({
  useEmail: () => () => 'sender@example.com',
}));
vi.mock('@app/constants/routerBase', () => ({
  ROUTER_BASE_CONCAT: '/app/',
  toBaseRelative: (value: string) => value.replace(/^\/app/, ''),
}));
vi.mock('@core/auth', () => ({ updateUserAuth: vi.fn() }));
vi.mock('@core/auth/native-auth', () => ({
  openDesktopAuthSession: vi.fn(),
  createNativeAuthSession: vi.fn(),
}));
vi.mock('@core/component/Toast/Toast', () => ({
  toast: { success: vi.fn(), failure: vi.fn(), alert: vi.fn() },
}));
vi.mock('@core/constant/PaywallState', () => ({
  PaywallKey: { MULTI_INBOX: 'multi-inbox' },
  usePaywallState: () => ({ showPaywall: vi.fn() }),
}));
vi.mock('@core/mobile/isNativeMobilePlatform', () => ({
  isNativeMobilePlatform: () => false,
}));
vi.mock('@core/util/platform', () => ({
  isPlatform: () => false,
  isTauri: () => false,
}));
vi.mock('@queries/auth', () => ({
  useInitGmailLink: () => ({ mutateAsync: vi.fn() }),
}));
vi.mock('@queries/auth/outlook-link', () => ({
  useInitOutlookLink: () => ({ mutateAsync: vi.fn() }),
  fetchEmailConnectionProviders: providers,
}));
vi.mock('@queries/auth/user-info', () => ({ invalidateUserInfo: vi.fn() }));
vi.mock('@queries/auth/account-scope', () => ({
  currentQueryAccount: () => ({ userId: 'viewer', session: 1 }),
  isCurrentQueryAccount: () => true,
  queryAccountSession: () => 1,
}));
vi.mock('@queries/email/focus', () => ({ FOCUS_WINDOW_DAYS: 30 }));
vi.mock('@queries/email/link', () => ({
  invalidateEmailLinks: vi.fn(),
  useEmailLinksQuery: () => ({
    refetch: vi.fn(),
    isPending: false,
    data: { links: [] },
  }),
  useInboxSuggestion: () => ({ isPending: true }),
}));
vi.mock('@service-email/client', () => ({
  emailClient: {
    init: vi.fn(),
    imapDiscover: mail.discover,
    imapConnect: mail.connect,
  },
  ALREADY_INITIALIZED_CODE: 'ALREADY_INITIALIZED',
  INBOX_BEING_REMOVED_CODE: 'INBOX_BEING_REMOVED',
  INBOX_CHANGED_CODE: 'INBOX_CHANGED',
  INBOX_IDENTITY_CONFLICT_CODE: 'INBOX_IDENTITY_CONFLICT',
  NO_GMAIL_GRANT_CODE: 'NO_GMAIL_GRANT',
  SHARED_INBOX_CONFLICT_CODE: 'SHARED_INBOX_CONFLICT',
}));
vi.mock('../email-view-context', () => ({
  useEmailView: () => ({
    state: { tab: 'important', search: '' },
    filtersChanged: () => false,
  }),
}));

vi.mock('@app/features/home/home-view-context', () => ({
  useHomeView: () => ({
    state: { tab: 'important', search: '', facets: {} },
    setFacets: vi.fn(),
  }),
}));

beforeEach(() => {
  mail.discover.mockResolvedValue(
    ok({
      imap: {
        host: 'in.example.com',
        username: 'in-user',
        port: 993,
        tls: 'implicit',
      },
      smtp: {
        host: 'out.example.com',
        username: 'out-user',
        port: 587,
        tls: 'start_tls',
      },
      hostConfirmationRequired: true,
    })
  );
  vi.stubGlobal('scrollTo', vi.fn());
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
  );
});
afterEach(() => {
  cleanup();
  vi.resetAllMocks();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe.each([
  { name: 'Email', EmptyState: EmailEmptyState },
  { name: 'Home', EmptyState: HomeEmptyState },
])('$name connection lifetime', ({ EmptyState }) => {
  it.each([
    { state: 'loading', ready: false },
    { state: 'loaded', ready: true },
  ])(
    'keeps the provider chooser open across a list reload with $state providers',
    async ({ ready }) => {
      const pending = Promise.withResolvers<{
        gmail: boolean;
        outlook: boolean;
        imap: boolean;
      }>();
      providers.mockReturnValue(pending.promise);
      if (ready) pending.resolve({ gmail: true, outlook: true, imap: true });
      const [loading, setLoading] = createSignal(false);
      const view = render(() => {
        // EmailList survives the loading/empty branch change. Its connect flow
        // must have that same lifetime, including the real owner-bound dialog.
        const connectInbox = useAddInboxFlow();
        return (
          <>
            <Show when={!loading()} fallback={<p>Loading email</p>}>
              <EmptyState onConnect={connectInbox} />
            </Show>
            <ImperativeDialogHost />
          </>
        );
      });
      fireEvent.click(screen.getByRole('button', { name: 'Connect email' }));
      const dialog = await screen.findByRole('dialog');
      if (ready) {
        await screen.findByRole('button', {
          name: 'Other email (IMAP / SMTP)',
        });
      } else {
        expect(screen.getByText('Loading email providers…')).toBeDefined();
      }
      setLoading(true);
      expect(screen.getByText('Loading email')).toBeDefined();
      expect(screen.getByRole('dialog')).toBe(dialog);
      pending.resolve({ gmail: true, outlook: true, imap: true });
      await screen.findByRole('button', { name: 'Other email (IMAP / SMTP)' });
      setLoading(false);
      expect(screen.getByRole('dialog')).toBe(dialog);
      expect(providers).toHaveBeenCalledTimes(1);
      view.unmount();
      expect(screen.queryByRole('dialog')).toBeNull();
    }
  );

  it('keeps a backdrop throughout the provider-to-IMAP handoff', async () => {
    providers.mockResolvedValue({ gmail: true, outlook: true, imap: true });
    render(() => {
      const connectInbox = useAddInboxFlow();
      return (
        <>
          <EmptyState onConnect={connectInbox} />
          <ImperativeDialogHost />
        </>
      );
    });
    fireEvent.click(screen.getByRole('button', { name: 'Connect email' }));
    const other = await screen.findByRole('button', {
      name: 'Other email (IMAP / SMTP)',
    });
    expect(document.querySelectorAll('.scrim-glass')).toHaveLength(1);
    const backdrops: number[] = [];
    const observer = new MutationObserver(() => {
      backdrops.push(document.querySelectorAll('.scrim-glass').length);
    });
    observer.observe(document.body, { childList: true, subtree: true });
    try {
      fireEvent.click(other);
      await screen.findByLabelText('Email address');
      expect(backdrops.length).toBeGreaterThan(0);
      expect(backdrops).not.toContain(0);
      expect(document.querySelectorAll('.scrim-glass')).toHaveLength(1);
    } finally {
      observer.disconnect();
    }
  });

  it.each([
    { action: 'view closes', reason: 'owner-disposed' },
    { action: 'Escape', reason: 'dismissed' },
  ])(
    'does not open a late IMAP form after $action during handoff',
    async ({ action, reason }) => {
      providers.mockResolvedValue({ gmail: true, outlook: true, imap: true });
      const span = Telemetry.span('test.handoff');
      const attribute = vi.spyOn(span, 'setAttr');
      vi.spyOn(Telemetry, 'span').mockReturnValue(span);
      render(() => <ImperativeDialogHost />);
      let pending: Promise<void> | undefined;
      const view = render(() => {
        const connectInbox = useAddInboxFlow();
        const connect: ReturnType<typeof useAddInboxFlow> = (options) => {
          pending = connectInbox(options);
          return pending;
        };
        return <EmptyState onConnect={connect} />;
      });
      fireEvent.click(screen.getByRole('button', { name: 'Connect email' }));
      fireEvent.click(
        await screen.findByRole('button', { name: 'Other email (IMAP / SMTP)' })
      );
      if (action === 'view closes') view.unmount();
      else fireEvent.keyDown(document.body, { key: 'Escape' });
      await pending;
      expect(screen.queryByRole('dialog')).toBeNull();
      expect(mail.connect).not.toHaveBeenCalled();
      expect(attribute).toHaveBeenCalledWith('dialog.close_reason', reason);
    }
  );

  it('keeps the IMAP form and typed credentials across loading and empty states', async () => {
    providers.mockResolvedValue({ gmail: true, outlook: true, imap: true });
    const [loading, setLoading] = createSignal(false);
    const view = render(() => {
      const connectInbox = useAddInboxFlow();
      return (
        <>
          <Show when={!loading()} fallback={<p>Loading email</p>}>
            <EmptyState onConnect={connectInbox} />
          </Show>
          <ImperativeDialogHost />
        </>
      );
    });
    fireEvent.click(screen.getByRole('button', { name: 'Connect email' }));
    fireEvent.click(
      await screen.findByRole('button', { name: 'Other email (IMAP / SMTP)' })
    );
    fireEvent.input(await screen.findByLabelText('Email address'), {
      target: { value: 'mailbox@example.com' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Find settings' }));
    const password = await screen.findByLabelText('Password or app password');
    fireEvent.input(password, { target: { value: 'example-app-password' } });
    fireEvent.input(screen.getAllByLabelText('Username')[0], {
      target: { value: 'typed-user' },
    });
    const dialog = screen.getByRole('dialog');
    setLoading(true);
    expect(screen.getByText('Loading email')).toBeDefined();
    expect(screen.getByRole('dialog')).toBe(dialog);
    expect(screen.getAllByLabelText('Username')[0]).toHaveProperty(
      'value',
      'typed-user'
    );
    expect(screen.getByLabelText('Password or app password')).toBe(password);
    expect(password).toHaveProperty('value', 'example-app-password');
    setLoading(false);
    expect(screen.getByRole('dialog')).toBe(dialog);
    expect(screen.getAllByLabelText('Username')[0]).toHaveProperty(
      'value',
      'typed-user'
    );
    expect(password).toHaveProperty('value', 'example-app-password');
    expect(mail.connect).not.toHaveBeenCalled();
    view.unmount();
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(password.isConnected).toBe(false);
  });
});
