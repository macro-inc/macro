/** @vitest-environment jsdom */

import type { Discovery } from '@service-email/generated/schemas';
import { ImapConnectionErrorCode } from '@service-email/generated/schemas/imapConnectionErrorCode';
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from '@solidjs/testing-library';
import { ImperativeDialogHost } from '@ui';
import { err, ok, type Result } from 'neverthrow';
import { createRoot, getOwner } from 'solid-js';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ImapConnectDialog, openImapConnection } from './ImapConnectDialog';

const mail = vi.hoisted(() => ({
  discover: vi.fn(),
  settings: vi.fn(),
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
  emailClient: {
    imapDiscover: mail.discover,
    imapConnect: mail.connect,
    getImapMailboxSettings: mail.settings,
  },
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
  const endpoints = {
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
  } satisfies Pick<Discovery, 'imap' | 'smtp'>;
  mail.discover.mockResolvedValue(
    ok({ ...endpoints, hostConfirmationRequired: true })
  );
  mail.settings.mockResolvedValue(
    ok({ ...endpoints, provider: 'Stored provider' })
  );
});
afterEach(() => {
  cleanup();
  vi.resetAllMocks();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it('resolves a payment refusal for the paywall and clears the password', async () => {
  mail.connect.mockResolvedValue(
    err([
      {
        code: ImapConnectionErrorCode.payment_required,
        message: 'IMAP connection refused',
      },
    ])
  );
  const onResult = vi.fn();
  render(() => (
    <ImapConnectDialog
      open
      onOpenChange={() => {}}
      onResult={onResult}
      emailAddress="owner@example.com"
    />
  ));

  const password = await screen.findByLabelText('Password or app password');
  fireEvent.click(screen.getByRole('checkbox', { name: /I trust/ }));
  fireEvent.input(password, { target: { value: 'synthetic-app-password' } });
  fireEvent.click(screen.getByRole('button', { name: 'Connect inbox' }));

  await vi.waitFor(() =>
    expect(onResult).toHaveBeenCalledWith({ type: 'payment_required' })
  );
  expect(password).toHaveProperty('value', '');
});

it('binds reconnect to its inbox, requires confirmation again when a destination changes, and erases refused credentials', async () => {
  const result = vi.fn();
  mail.connect.mockResolvedValue(
    err([{ code: 'credentials_rejected', message: 'IMAP connection refused' }])
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
  expect(mail.settings).toHaveBeenCalledWith(
    'existing-inbox',
    expect.any(AbortSignal),
    expect.anything()
  );
  expect(mail.discover).not.toHaveBeenCalled();
  expect(incomingPassword.getAttribute('autocomplete')).toBe('off');
  expect(
    incomingPassword.closest('form')?.classList.contains('ph-no-capture')
  ).toBe(true);
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
  expect(outgoingPassword.getAttribute('autocomplete')).toBe('off');
  fireEvent.input(outgoingPassword, {
    target: { value: 'outgoing-app-password' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Reconnect' }));
  await screen.findByRole('alert');
  expect(mail.connect).toHaveBeenCalledTimes(1);
  expect(mail.connect.mock.calls[0][0]).toEqual({
    requestId: expect.any(String),
    linkId: 'existing-inbox',
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

it.each([
  {
    code: 'credentials_rejected',
    guidance: 'Sign-in was rejected. Check your username and app password.',
    reuseId: false,
  },
  {
    code: 'credentials_unreadable',
    guidance:
      'Could not verify the connection. Check the server settings and try again.',
    reuseId: true,
  },
])(
  'keeps confirmed settings and retries after $code',
  async ({ code, guidance, reuseId }) => {
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
        err([{ code, message: 'IMAP connection refused' }])
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
    expect((await screen.findByRole('alert')).textContent).toContain(guidance);
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
    await vi.waitFor(() =>
      expect(result).toHaveBeenCalledWith({
        type: 'connected',
        linkId: 'connected-inbox',
      })
    );
    expect(mail.connect).toHaveBeenCalledTimes(2);
    expect(mail.connect.mock.calls[1][0].imap.password).toBe(
      'corrected-test-password'
    );
    const firstId = mail.connect.mock.calls[0][0].requestId;
    const retryId = mail.connect.mock.calls[1][0].requestId;
    expect(retryId === firstId).toBe(reuseId);
    expect(password).toHaveProperty('value', '');
  }
);

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

it.each([
  {
    code: 'address_unverified',
    guidance: 'Connect a verified address associated with your Macro account.',
  },
  {
    code: 'person_required',
    guidance: 'Sign in as yourself to connect this inbox.',
  },
])(
  'keeps password entry closed after discovery returns $code',
  async ({ code, guidance }) => {
    mail.discover.mockResolvedValue(
      err([{ code, message: 'IMAP connection refused' }])
    );
    render(() => (
      <ImapConnectDialog open onOpenChange={() => {}} onResult={() => {}} />
    ));
    expect(await screen.findByRole('alert')).toHaveProperty(
      'textContent',
      guidance
    );
    expect(screen.queryByLabelText('Password or app password')).toBeNull();
  }
);

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
  const close = vi.fn();
  render(() => (
    <ImapConnectDialog
      open
      onOpenChange={close}
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
  expect(screen.getByRole('button', { name: 'Cancel' })).toHaveProperty(
    'disabled',
    false
  );
  fireEvent.keyDown(document, { key: 'Escape' });
  expect(close).not.toHaveBeenCalled();
  first.resolve(
    err([{ code: 'credentials_rejected', message: 'IMAP connection refused' }])
  );
  await screen.findByRole('alert');
  expect(button.getAttribute('aria-busy')).toBeNull();
  expect(screen.getByRole('button', { name: 'Cancel' })).toHaveProperty(
    'disabled',
    false
  );
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
  expect(incoming.getAttribute('autocomplete')).toBe('off');
  fireEvent.click(screen.getByRole('checkbox', { name: /I trust/ }));
  const separate = screen.getByLabelText('Use a separate outgoing password');
  fireEvent.click(separate);
  const outgoing = screen.getByLabelText('Outgoing password');
  expect(outgoing).toHaveProperty('value', '');
  expect(outgoing.getAttribute('autocomplete')).toBe('off');
  fireEvent.input(outgoing, { target: { value: 'temporary-test-secret' } });
  fireEvent.click(separate);
  fireEvent.click(separate);
  expect(screen.getByLabelText('Outgoing password')).toHaveProperty(
    'value',
    ''
  );
  expect(mail.connect).not.toHaveBeenCalled();
});

it('allows confirmed manual reconnect when saved endpoints cannot be loaded', async () => {
  mail.settings.mockResolvedValue(
    err([
      {
        code: ImapConnectionErrorCode.credentials_unreadable,
        message: 'Unavailable',
      },
    ])
  );
  mail.connect.mockResolvedValue(ok({ linkId: 'existing-inbox' }));
  const onResult = vi.fn();
  render(() => (
    <ImapConnectDialog
      open
      onOpenChange={() => {}}
      onResult={onResult}
      emailAddress="owner@example.com"
      linkId="existing-inbox"
    />
  ));

  const password = await screen.findByLabelText('Password or app password');
  const [incoming, outgoing] = screen.getAllByLabelText('Server name');
  expect(incoming).toHaveProperty('value', '');
  expect(outgoing).toHaveProperty('value', '');
  expect(password).toHaveProperty('disabled', true);
  expect(mail.discover).not.toHaveBeenCalled();
  expect(mail.connect).not.toHaveBeenCalled();
  fireEvent.input(incoming, { target: { value: 'imap.example.com' } });
  fireEvent.input(outgoing, { target: { value: 'smtp.example.com' } });
  fireEvent.click(screen.getByRole('checkbox', { name: /I trust/ }));
  fireEvent.input(password, { target: { value: 'synthetic-app-password' } });
  fireEvent.click(screen.getByRole('button', { name: 'Reconnect' }));
  await vi.waitFor(() =>
    expect(onResult).toHaveBeenCalledWith({
      type: 'connected',
      linkId: 'existing-inbox',
    })
  );
  expect(mail.connect.mock.calls[0][0]).toMatchObject({
    linkId: 'existing-inbox',
    confirmedHosts: ['imap.example.com', 'smtp.example.com'],
  });
});

it.each([
  { steer: 'gmail', provider: 'GMAIL', name: 'Google' },
  { steer: 'outlook', provider: 'OUTLOOK', name: 'Microsoft' },
])(
  'steers $name mail to OAuth using the signed-in address',
  async ({ steer, provider, name }) => {
    mail.discover.mockResolvedValue(ok({ steer, provider: name }));
    const result = vi.fn();
    render(() => (
      <ImapConnectDialog open onOpenChange={() => {}} onResult={result} />
    ));

    const oauth = await screen.findByRole('button', {
      name: `Continue with ${name}`,
    });
    expect(screen.queryByLabelText('Password or app password')).toBeNull();
    fireEvent.click(oauth);

    expect(result).toHaveBeenCalledWith({
      type: 'oauth',
      provider,
      emailAddress: 'owner@example.com',
    });
    expect(mail.connect).not.toHaveBeenCalled();
  }
);

it('keeps an existing Google IMAP reconnect on its bound password flow', async () => {
  mail.settings.mockResolvedValue(
    ok({
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
  fireEvent.click(screen.getByRole('button', { name: 'Reconnect' }));
  await vi.waitFor(() =>
    expect(result).toHaveBeenCalledWith({
      type: 'connected',
      linkId: 'existing-inbox',
    })
  );
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
    await vi.waitFor(() =>
      expect(result).toHaveBeenCalledWith({
        type: 'connected',
        linkId: 'password-connected-inbox',
      })
    );
    expect(mail.connect.mock.calls[0][0].imap.password).toBe(
      'synthetic-app-password'
    );
    expect(result).not.toHaveBeenCalledWith('GMAIL');
    expect(result).not.toHaveBeenCalledWith('OUTLOOK');
  }
);

it('retains the discovered submission port when switching to a standard port and back', async () => {
  mail.discover.mockResolvedValue(
    ok({
      imap: {
        host: 'imap.example.com',
        username: 'owner@example.com',
        port: 993,
        tls: 'implicit',
      },
      smtp: {
        host: 'smtp.example.com',
        username: 'owner@example.com',
        port: 2525,
        tls: 'implicit',
      },
      hostConfirmationRequired: true,
    })
  );
  render(() => (
    <ImapConnectDialog
      open
      onOpenChange={() => {}}
      onResult={() => {}}
      emailAddress="owner@example.com"
    />
  ));
  await screen.findByLabelText('Password or app password');
  fireEvent.click(screen.getByRole('button', { name: 'Server settings' }));
  const smtp = screen.getByRole('group', { name: 'Outgoing mail (SMTP)' });
  const connection = within(smtp).getByRole('button', { name: /^Connection/ });
  expect(connection.textContent).toContain('2525');
  fireEvent.keyDown(connection, { key: 'ArrowDown', code: 'ArrowDown' });
  fireEvent.click(await screen.findByRole('option', { name: /587/ }));
  expect(connection.textContent).toContain('587');
  fireEvent.keyDown(connection, { key: 'ArrowDown', code: 'ArrowDown' });
  fireEvent.click(await screen.findByRole('option', { name: /2525/ }));
  expect(connection.textContent).toContain('2525');
  expect(connection.textContent).toContain('TLS');
  expect(mail.connect).not.toHaveBeenCalled();
});

it.each(['discovery', 'connect'])(
  'explicitly cancels pending %s and ignores its late result',
  async (phase) => {
    const pending =
      Promise.withResolvers<
        Result<{ linkId: string }, { code: string; message: string }[]>
      >();
    const close = vi.fn();
    const result = vi.fn();
    if (phase === 'discovery')
      mail.discover.mockReturnValueOnce(pending.promise);
    else mail.connect.mockReturnValueOnce(pending.promise);
    render(() => (
      <ImapConnectDialog
        open
        onOpenChange={close}
        onResult={result}
        emailAddress="owner@example.com"
      />
    ));
    if (phase === 'connect') {
      const password = await screen.findByLabelText('Password or app password');
      fireEvent.click(screen.getByRole('checkbox', { name: /I trust/ }));
      fireEvent.input(password, { target: { value: 'synthetic-password' } });
      fireEvent.click(screen.getByRole('button', { name: 'Connect inbox' }));
    }
    const request = phase === 'discovery' ? mail.discover : mail.connect;
    await vi.waitFor(() => expect(request).toHaveBeenCalledTimes(1));
    const signal = request.mock.calls[0][
      phase === 'discovery' ? 0 : 1
    ] as AbortSignal;
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(signal.aborted).toBe(true);
    expect(close).toHaveBeenCalledWith(false);
    pending.resolve(ok({ linkId: 'late-inbox' }));
    await pending.promise;
    expect(result).not.toHaveBeenCalled();
  }
);

it.each([
  ['discovery', 20_000],
  ['connect', 95_000],
] as const)('ends stalled %s at its deadline', async (phase, deadline) => {
  const pending =
    Promise.withResolvers<
      Result<{ linkId: string }, { code: string; message: string }[]>
    >();
  if (phase === 'discovery') mail.discover.mockReturnValueOnce(pending.promise);
  else mail.connect.mockReturnValueOnce(pending.promise);
  try {
    if (phase === 'discovery') vi.useFakeTimers();
    render(() => (
      <ImapConnectDialog
        open
        onOpenChange={() => {}}
        onResult={() => {}}
        emailAddress="owner@example.com"
      />
    ));
    if (phase === 'connect') {
      const password = await screen.findByLabelText('Password or app password');
      fireEvent.click(screen.getByRole('checkbox', { name: /I trust/ }));
      fireEvent.input(password, { target: { value: 'synthetic-password' } });
      vi.useFakeTimers();
      fireEvent.click(screen.getByRole('button', { name: 'Connect inbox' }));
    }
    await vi.advanceTimersByTimeAsync(deadline);
    const request = phase === 'discovery' ? mail.discover : mail.connect;
    const signal = request.mock.calls[0][
      phase === 'discovery' ? 0 : 1
    ] as AbortSignal;
    expect(signal.aborted).toBe(true);
    expect(
      screen
        .getByRole('button', {
          name: phase === 'connect' ? 'Connect inbox' : 'Try again',
        })
        .getAttribute('aria-busy')
    ).toBeNull();
    expect(screen.getByRole('alert')).toBeTruthy();
  } finally {
    pending.resolve(ok({ linkId: 'late-inbox' }));
    vi.useRealTimers();
  }
});

it('can connect with an app password after discovery returns a future steer value', async () => {
  // A running older client can receive values added by a newer server.
  mail.discover.mockResolvedValue(
    ok({
      steer: 'future_provider',
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
  mail.connect.mockResolvedValue(ok({ linkId: 'new-inbox' }));
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
  fireEvent.click(screen.getByRole('checkbox', { name: /I trust/ }));
  fireEvent.input(password, { target: { value: 'synthetic-app-password' } });
  fireEvent.click(screen.getByRole('button', { name: 'Connect inbox' }));
  await vi.waitFor(() =>
    expect(result).toHaveBeenCalledWith({
      type: 'connected',
      linkId: 'new-inbox',
    })
  );
  expect(mail.connect).toHaveBeenCalledTimes(1);
  expect(mail.providers).not.toHaveBeenCalled();
});

it('returns the newly connected link when setup completes', async () => {
  const linkId = '018f0000-0000-7000-8000-000000000123';
  mail.connect.mockResolvedValue(ok({ linkId }));
  render(() => <ImperativeDialogHost />);
  const owner = createRoot((dispose) => ({ owner: getOwner(), dispose }));
  try {
    const connection = openImapConnection(owner.owner, 'owner@example.com');
    const password = await screen.findByLabelText('Password or app password');
    fireEvent.click(screen.getByRole('checkbox', { name: /I trust/ }));
    fireEvent.input(password, { target: { value: 'synthetic-app-password' } });
    fireEvent.click(screen.getByRole('button', { name: 'Connect inbox' }));
    await expect(connection).resolves.toEqual({ type: 'connected', linkId });
  } finally {
    owner.dispose();
  }
});
