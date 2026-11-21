/** @vitest-environment jsdom */

import type { Discovery } from '@service-email/generated/schemas';
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from '@solidjs/testing-library';
import { err, ok, type Result } from 'neverthrow';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ImapConnectDialog } from './ImapConnectDialog';

const mail = vi.hoisted(() => ({
  discover: vi.fn(),
  connect: vi.fn(),
  accountCurrent: vi.fn(),
  providers: vi.fn(),
}));
vi.mock('@core/context/user', () => ({
  useEmail: () => () => 'owner@example.com',
}));
vi.mock('@queries/auth/account-scope', () => ({
  currentQueryAccount: () => ({ userId: 'owner', session: 1 }),
  isCurrentQueryAccount: mail.accountCurrent,
  queryAccountSession: () => 1,
}));
vi.mock('@queries/auth/outlook-link', () => ({
  fetchEmailConnectionProviders: mail.providers,
}));
vi.mock('@service-email/client', () => ({
  emailClient: { imapDiscover: mail.discover, imapConnect: mail.connect },
}));

beforeEach(() => {
  vi.stubGlobal('scrollTo', vi.fn());
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
  );
  mail.accountCurrent.mockReturnValue(true);
  mail.providers.mockResolvedValue({ gmail: true, outlook: true, imap: true });
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
});
afterEach(() => {
  cleanup();
  vi.resetAllMocks();
  vi.unstubAllGlobals();
});

it('binds reconnect to its inbox, requires confirmation again when a destination changes, and erases refused credentials', async () => {
  const result = vi.fn();
  mail.connect.mockResolvedValue(
    err([{ code: 'IMAP_CONNECTION_REFUSED', message: 'credentials_rejected' }])
  );
  render(() => (
    <ImapConnectDialog
      open
      onOpenChange={() => {}}
      onResult={result}
      emailAddress="owner@example.com"
      linkId="existing-inbox"
    />
  ));
  const incomingPassword = await screen.findByLabelText(
    'Password or app password'
  );
  const confirm = screen.getByRole('checkbox', { name: /I trust/ });
  expect(incomingPassword).toHaveProperty('disabled', true);
  fireEvent.click(confirm);
  fireEvent.input(incomingPassword, {
    target: { value: 'first-app-password' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Server settings' }));
  const smtp = screen.getByRole('group', {
    name: 'Outgoing mail (SMTP)',
    hidden: true,
  });
  fireEvent.input(within(smtp).getByLabelText('Server name'), {
    target: { value: 'smtp.example.com' },
  });
  expect(confirm).toHaveProperty('checked', false);
  expect(incomingPassword).toHaveProperty('value', '');
  fireEvent.click(confirm);
  fireEvent.input(incomingPassword, {
    target: { value: 'incoming-app-password' },
  });
  fireEvent.click(screen.getByLabelText('Use a separate outgoing password'));
  const outgoingPassword = screen.getByLabelText('Outgoing password');
  fireEvent.input(outgoingPassword, {
    target: { value: 'outgoing-app-password' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Connect inbox' }));
  await screen.findByRole('alert');
  expect(mail.connect).toHaveBeenCalledTimes(1);
  expect(mail.connect.mock.calls[0][0]).toEqual({
    requestId: expect.any(String),
    linkId: 'existing-inbox',
    email: 'owner@example.com',
    imap: {
      endpoint: {
        host: 'in.example.com',
        username: 'in-user',
        port: 993,
        tls: 'implicit',
      },
      password: 'incoming-app-password',
    },
    smtp: {
      endpoint: {
        host: 'smtp.example.com',
        username: 'out-user',
        port: 587,
        tls: 'start_tls',
      },
      password: 'outgoing-app-password',
    },
    confirmedHosts: ['in.example.com', 'smtp.example.com'],
  });
  expect(incomingPassword).toHaveProperty('value', '');
  expect(outgoingPassword).toHaveProperty('value', '');
  expect(result).not.toHaveBeenCalled();
});

it('retains confirmed settings and provider help after a rejected login, then retries with new secrets', async () => {
  mail.discover.mockResolvedValueOnce(
    ok({
      imap: {
        host: 'imap.example.com',
        username: 'incoming-user',
        port: 993,
        tls: 'implicit',
      },
      smtp: {
        host: 'smtp.example.com',
        username: 'outgoing-user',
        port: 465,
        tls: 'implicit',
      },
      helpUrl: 'https://example.com/app-password',
      hostConfirmationRequired: true,
    })
  );
  mail.connect
    .mockResolvedValueOnce(
      err([
        { code: 'IMAP_CONNECTION_REFUSED', message: 'credentials_rejected' },
      ])
    )
    .mockResolvedValueOnce(ok({ linkId: 'connected-inbox' }));
  const result = vi.fn();
  render(() => (
    <ImapConnectDialog
      open
      onOpenChange={() => {}}
      onResult={result}
      emailAddress="owner@example.com"
    />
  ));
  const password = await screen.findByLabelText('Password or app password');
  const confirm = screen.getByRole('checkbox', { name: /I trust/ });
  fireEvent.click(confirm);
  fireEvent.input(password, { target: { value: 'incorrect-test-password' } });
  fireEvent.click(screen.getByRole('button', { name: 'Connect inbox' }));
  expect((await screen.findByRole('alert')).textContent).toContain(
    'Sign-in was rejected. Check your username and app password.'
  );
  expect(password).toHaveProperty('value', '');
  expect(confirm).toHaveProperty('checked', true);
  expect(
    screen
      .getByRole('link', { name: 'Create an app password' })
      .getAttribute('href')
  ).toBe('https://example.com/app-password');
  fireEvent.click(screen.getByRole('button', { name: 'Server settings' }));
  const imap = screen.getByRole('group', { name: 'Incoming mail (IMAP)' });
  expect(within(imap).getByLabelText('Server name')).toHaveProperty(
    'value',
    'imap.example.com'
  );
  expect(within(imap).getByLabelText('Username')).toHaveProperty(
    'value',
    'incoming-user'
  );
  fireEvent.input(password, { target: { value: 'corrected-test-password' } });
  fireEvent.click(screen.getByRole('button', { name: 'Connect inbox' }));
  await vi.waitFor(() => expect(result).toHaveBeenCalledWith('connected'));
  expect(mail.connect).toHaveBeenCalledTimes(2);
  expect(mail.connect.mock.calls[1][0].imap.password).toBe(
    'corrected-test-password'
  );
  expect(mail.connect.mock.calls[1][0].requestId).not.toBe(
    mail.connect.mock.calls[0][0].requestId
  );
  expect(password).toHaveProperty('value', '');
});

it('discards discovery when the signed-in account changes', async () => {
  const outcome = Promise.withResolvers<Result<Discovery, never>>();
  mail.discover.mockReturnValue(outcome.promise);
  render(() => (
    <ImapConnectDialog
      open
      onOpenChange={() => {}}
      onResult={() => {}}
      emailAddress="owner@example.com"
    />
  ));
  await vi.waitFor(() => expect(mail.discover).toHaveBeenCalledTimes(1));
  mail.accountCurrent.mockReturnValue(false);
  outcome.resolve(ok({ hostConfirmationRequired: true }));
  await outcome.promise;
  expect(screen.queryByLabelText('Password or app password')).toBeNull();
  expect(mail.connect).not.toHaveBeenCalled();
});

it('keeps password entry closed when the server refuses discovery for an unverified address', async () => {
  mail.discover.mockResolvedValue(
    err([{ code: 'IMAP_CONNECTION_REFUSED', message: 'address_unverified' }])
  );
  render(() => (
    <ImapConnectDialog
      open
      onOpenChange={() => {}}
      onResult={() => {}}
      emailAddress="unverified@example.com"
    />
  ));
  expect(await screen.findByRole('alert')).toHaveProperty(
    'textContent',
    'Connect a verified address associated with your Macro account.'
  );
  expect(screen.queryByLabelText('Password or app password')).toBeNull();
});

it('keeps the same connection action and label while checking, failing and retrying', async () => {
  const first =
    Promise.withResolvers<
      Result<{ linkId: string }, { code: string; message: string }[]>
    >();
  const retry =
    Promise.withResolvers<
      Result<{ linkId: string }, { code: string; message: string }[]>
    >();
  mail.connect
    .mockReturnValueOnce(first.promise)
    .mockReturnValueOnce(retry.promise);
  render(() => (
    <ImapConnectDialog
      open
      onOpenChange={() => {}}
      onResult={() => {}}
      emailAddress="owner@example.com"
    />
  ));
  const password = await screen.findByLabelText('Password or app password');
  fireEvent.click(screen.getByRole('checkbox', { name: /I trust/ }));
  fireEvent.input(password, { target: { value: 'synthetic-test-password' } });
  const button = screen.getByRole('button', { name: 'Connect inbox' });
  fireEvent.click(button);
  await vi.waitFor(() => expect(button.getAttribute('aria-busy')).toBe('true'));
  expect(screen.getByRole('button', { name: 'Connect inbox' })).toBe(button);
  expect(button.textContent).toBe('Connect inbox');
  first.resolve(
    err([{ code: 'IMAP_CONNECTION_REFUSED', message: 'credentials_rejected' }])
  );
  await screen.findByRole('alert');
  expect(button.getAttribute('aria-busy')).toBeNull();
  fireEvent.input(password, { target: { value: 'corrected-test-password' } });
  fireEvent.click(button);
  await vi.waitFor(() => expect(button.getAttribute('aria-busy')).toBe('true'));
  expect(screen.getByRole('button', { name: 'Connect inbox' })).toBe(button);
  retry.resolve(ok({ linkId: 'connected-inbox' }));
});

it('keeps reconnect secrets empty and forgets an unselected outgoing password', async () => {
  render(() => (
    <ImapConnectDialog
      open
      onOpenChange={() => {}}
      onResult={() => {}}
      emailAddress="owner@example.com"
      linkId="existing-inbox"
    />
  ));
  const incoming = await screen.findByLabelText('Password or app password');
  expect(incoming).toHaveProperty('value', '');
  expect(incoming.getAttribute('autocomplete')).toBe('current-password');
  fireEvent.click(screen.getByRole('checkbox', { name: /I trust/ }));
  const separate = screen.getByLabelText('Use a separate outgoing password');
  fireEvent.click(separate);
  const outgoing = screen.getByLabelText('Outgoing password');
  expect(outgoing).toHaveProperty('value', '');
  expect(outgoing.getAttribute('autocomplete')).toBe('current-password');
  fireEvent.input(outgoing, { target: { value: 'temporary-test-secret' } });
  fireEvent.click(separate);
  fireEvent.click(separate);
  expect(screen.getByLabelText('Outgoing password')).toHaveProperty(
    'value',
    ''
  );
  expect(mail.connect).not.toHaveBeenCalled();
});

it('steers Google-hosted mail to OAuth without collecting a password', async () => {
  mail.discover.mockResolvedValue(ok({ steer: 'gmail', provider: 'Google' }));
  const result = vi.fn();
  render(() => (
    <ImapConnectDialog
      open
      onOpenChange={() => {}}
      onResult={result}
      emailAddress="owner@example.com"
    />
  ));
  const google = await screen.findByRole('button', {
    name: 'Continue with Google',
  });
  expect(screen.queryByLabelText('Password or app password')).toBeNull();
  fireEvent.click(google);
  expect(result).toHaveBeenCalledWith('GMAIL');
  expect(mail.connect).not.toHaveBeenCalled();
});

it('keeps an existing Google IMAP reconnect on its bound password flow', async () => {
  mail.discover.mockResolvedValue(
    ok({
      steer: 'gmail',
      provider: 'Google',
      imap: {
        host: 'imap.example.com',
        username: 'owner@example.com',
        port: 993,
        tls: 'implicit',
      },
      smtp: {
        host: 'smtp.example.com',
        username: 'owner@example.com',
        port: 465,
        tls: 'implicit',
      },
      hostConfirmationRequired: true,
    })
  );
  mail.connect.mockResolvedValue(ok({ linkId: 'existing-inbox' }));
  const result = vi.fn();
  render(() => (
    <ImapConnectDialog
      open
      onOpenChange={() => {}}
      onResult={result}
      emailAddress="owner@example.com"
      linkId="existing-inbox"
    />
  ));
  const password = await screen.findByLabelText('Password or app password');
  expect(
    screen.queryByRole('button', { name: 'Continue with Google' })
  ).toBeNull();
  fireEvent.click(screen.getByRole('checkbox', { name: /I trust/ }));
  fireEvent.input(password, { target: { value: 'synthetic-app-password' } });
  fireEvent.click(screen.getByRole('button', { name: 'Connect inbox' }));
  await vi.waitFor(() => expect(result).toHaveBeenCalledWith('connected'));
  expect(mail.connect.mock.calls[0][0].linkId).toBe('existing-inbox');
  expect(result).not.toHaveBeenCalledWith('GMAIL');
});

it.each([
  ['gmail', 'Google', true],
  ['gmail', 'Google', false],
  ['outlook', 'Microsoft', true],
  ['outlook', 'Microsoft', false],
] as const)(
  'connects %s (%s) with an app password when OAuth availability is %s',
  async (steer, provider, available) => {
    mail.providers.mockResolvedValue({
      gmail: steer === 'gmail' ? available : true,
      outlook: steer === 'outlook' ? available : true,
      imap: true,
    });
    mail.discover.mockResolvedValue(
      ok({
        steer,
        provider,
        imap: {
          host: 'imap.example.com',
          username: 'owner@example.com',
          port: 993,
          tls: 'implicit',
        },
        smtp: {
          host: 'smtp.example.com',
          username: 'owner@example.com',
          port: 465,
          tls: 'implicit',
        },
        hostConfirmationRequired: true,
      })
    );
    mail.connect.mockResolvedValue(ok({ linkId: 'password-connected-inbox' }));
    const result = vi.fn();
    render(() => (
      <ImapConnectDialog
        open
        onOpenChange={() => {}}
        onResult={result}
        emailAddress="owner@example.com"
      />
    ));
    if (available) {
      await screen.findByRole('button', { name: `Continue with ${provider}` });
      fireEvent.click(
        screen.getByRole('button', { name: 'Use an app password instead' })
      );
    }
    const password = await screen.findByLabelText('Password or app password');
    if (!available)
      expect(
        screen.queryByRole('button', { name: `Continue with ${provider}` })
      ).toBeNull();
    fireEvent.click(screen.getByRole('checkbox', { name: /I trust/ }));
    fireEvent.input(password, { target: { value: 'synthetic-app-password' } });
    fireEvent.click(screen.getByRole('button', { name: 'Connect inbox' }));
    await vi.waitFor(() => expect(result).toHaveBeenCalledWith('connected'));
    expect(mail.connect.mock.calls[0][0].imap.password).toBe(
      'synthetic-app-password'
    );
    expect(result).not.toHaveBeenCalledWith('GMAIL');
    expect(result).not.toHaveBeenCalledWith('OUTLOOK');
  }
);
