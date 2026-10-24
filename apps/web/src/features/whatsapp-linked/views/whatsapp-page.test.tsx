import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@solidjs/testing-library';
import { errAsync, okAsync } from 'neverthrow';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WhatsAppLinkedProvider } from '../context/whatsapp-linked-context';
import { createFakeWhatsApp } from '../tests/fake-capabilities';
import { WhatsAppPage } from './whatsapp-page';

vi.mock('@core/mobile/isMobile', () => ({ isMobile: () => false }));

beforeEach(() => {
  vi.stubGlobal('scrollTo', vi.fn());
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe = vi.fn();
      unobserve = vi.fn();
      disconnect = vi.fn();
    }
  );
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function mount(
  fake: ReturnType<typeof createFakeWhatsApp>,
  resumePairingId?: string
) {
  render(() => (
    <WhatsAppLinkedProvider value={fake.capabilities}>
      <WhatsAppPage resumePairingId={resumePairingId} />
    </WhatsAppLinkedProvider>
  ));
}

/** Kobalte keeps a closing dialog mounted, marked closed, until its exit animation. */
const dialogOpen = () =>
  screen
    .queryAllByRole('dialog')
    .some((dialog) => !dialog.hasAttribute('data-closed'));

const groups = [
  {
    jid: '120363001@g.us',
    name: 'Design Crit',
    memberCount: 14,
    inMacro: { kind: 'own' as const, groupId: 'group-design' },
    unsupported: undefined,
  },
  {
    jid: '120363003@g.us',
    name: 'Launch War Room',
    memberCount: 23,
    inMacro: undefined,
    unsupported: undefined,
  },
  {
    jid: '120363004@g.us',
    name: 'Ana, Ben, +2',
    memberCount: 4,
    inMacro: {
      kind: 'shared' as const,
      groupId: 'group-family',
      ownerId: 'macro|ana@example.test',
      ownerName: 'Ana Silva',
    },
    unsupported: undefined,
  },
  {
    jid: '120363005@g.us',
    name: 'Neighbourhood',
    memberCount: 120,
    inMacro: undefined,
    unsupported: 'community' as const,
  },
];

describe('not connected', () => {
  it('explains the account risk and links WhatsApp through a QR dialog', async () => {
    vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] });
    vi.setSystemTime(new Date('2026-10-20T12:00:00.000Z'));
    const fake = createFakeWhatsApp({ account: null });
    mount(fake);

    expect(
      screen.getByText(/unofficial WhatsApp client/, { exact: false })
    ).toBeTruthy();
    expect(fake.groupsEnabled[0]?.()).toBe(false);

    fireEvent.click(screen.getByRole('button', { name: 'Connect' }));
    expect(fake.capabilities.connect).toHaveBeenCalledWith(false);
    const dialog = within(await screen.findByRole('dialog'));
    expect(dialog.getByText('Link WhatsApp')).toBeTruthy();
    expect(dialog.getByText('Preparing code…')).toBeTruthy();
    expect(dialog.getByText('Tap Link a device')).toBeTruthy();

    fake.setPairing({ kind: 'scan', qr: '2@pairing-ref,key,identity,adv' });
    expect(
      dialog.getByRole('img', {
        name: 'Scan this code with WhatsApp on your phone',
      })
    ).toBeTruthy();
    expect(dialog.getByText('Expires in 0:52')).toBeTruthy();
    vi.advanceTimersByTime(2_000);
    expect(dialog.getByText('Expires in 0:50')).toBeTruthy();

    fireEvent.click(dialog.getByRole('button', { name: 'Cancel' }));
    await waitFor(() =>
      expect(fake.capabilities.cancelPairing).toHaveBeenCalledWith('pairing-1')
    );
    await waitFor(() => expect(dialogOpen()).toBe(false));
  });

  it('turns a QR that outlived its deadline into an expired step with a retry', async () => {
    vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] });
    vi.setSystemTime(new Date('2026-10-20T12:00:00.000Z'));
    const fake = createFakeWhatsApp({ account: null });
    mount(fake);
    fireEvent.click(screen.getByRole('button', { name: 'Connect' }));
    const dialog = within(await screen.findByRole('dialog'));
    fake.setPairing({ kind: 'scan', qr: '2@pairing-ref' });

    vi.advanceTimersByTime(53_000);
    expect(
      dialog.getByText('This code expired before it was scanned.')
    ).toBeTruthy();
    expect(dialog.queryByRole('img')).toBeNull();

    fireEvent.click(dialog.getByRole('button', { name: 'Show a new code' }));
    expect(fake.capabilities.connect).toHaveBeenCalledTimes(2);
  });

  it('closes the dialog and refreshes the account once the phone links', async () => {
    const fake = createFakeWhatsApp({ account: null });
    mount(fake);
    fireEvent.click(screen.getByRole('button', { name: 'Connect' }));
    await screen.findByRole('dialog');

    fake.setPairing({ kind: 'connected' });
    await waitFor(() =>
      expect(fake.capabilities.pairingFinished).toHaveBeenCalledOnce()
    );
    await waitFor(() => expect(dialogOpen()).toBe(false));
    expect(fake.capabilities.cancelPairing).not.toHaveBeenCalled();
  });

  it('closes the dialog when the account reads linked before the pairing poll does', async () => {
    const fake = createFakeWhatsApp({ account: null });
    mount(fake);
    fireEvent.click(screen.getByRole('button', { name: 'Connect' }));
    await screen.findByRole('dialog');
    fake.setPairing({ kind: 'scan', qr: '2@pairing-ref' });

    fake.setAccount({
      generation: 4,
      phone: '+14155550142',
      health: 'connected',
    });
    await waitFor(() => expect(dialogOpen()).toBe(false));
    expect(screen.getByText('+14155550142')).toBeTruthy();
    expect(fake.capabilities.cancelPairing).not.toHaveBeenCalled();
  });

  it('says so when linking could not start', async () => {
    const fake = createFakeWhatsApp({ account: null });
    fake.capabilities.connect.mockReturnValueOnce(
      errAsync({ kind: 'request-failed' })
    );
    mount(fake);
    fireEvent.click(screen.getByRole('button', { name: 'Connect' }));
    expect(
      await screen.findByText("Couldn't start linking WhatsApp. Try again.")
    ).toBeTruthy();
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});

describe('connected', () => {
  it('links a different account only after confirming the replacement', async () => {
    const fake = createFakeWhatsApp({
      account: { generation: 3, phone: '+14155550142', health: 'connected' },
      groups,
    });
    mount(fake);

    fireEvent.click(
      screen.getByRole('button', { name: 'Use a different account' })
    );
    expect(fake.capabilities.connect).not.toHaveBeenCalled();
    const confirm = within(await screen.findByRole('dialog'));
    fireEvent.click(
      confirm.getByRole('button', { name: 'Link another account' })
    );
    await waitFor(() =>
      expect(fake.capabilities.connect).toHaveBeenCalledWith(true)
    );
    expect(await screen.findByText('Link WhatsApp')).toBeTruthy();
    // The old account still reads linked; only the new pairing closes it.
    expect(dialogOpen()).toBe(true);
  });

  it('lists groups to add, opens shared ones, and disconnects after confirming', async () => {
    const fake = createFakeWhatsApp({
      account: { generation: 3, phone: '+14155550142', health: 'connected' },
      groups,
    });
    mount(fake);

    expect(screen.getByText('+14155550142')).toBeTruthy();
    expect(screen.getByText('Connected · linked device')).toBeTruthy();
    expect(fake.groupsEnabled[0]?.()).toBe(true);
    const list = within(
      screen.getByRole('list', { name: 'Groups to add to Macro' })
    );
    // Groups already in Macro live in External's sidebar, not here.
    expect(list.queryByText('Design Crit')).toBeNull();
    expect(list.getByText('23 members')).toBeTruthy();
    fireEvent.click(
      list.getByRole('button', { name: /Shared with you by Ana Silva/ })
    );
    expect(fake.capabilities.openGroup).toHaveBeenCalledWith('group-family');

    expect(screen.queryByText('Neighbourhood')).toBeNull();
    fireEvent.click(
      screen.getByRole('button', { name: /Can't be added \(1\)/ })
    );
    expect(await screen.findByText('Neighbourhood')).toBeTruthy();
    expect(
      screen.getByText('WhatsApp communities aren’t supported yet')
    ).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Disconnect' }));
    const confirm = within(await screen.findByRole('dialog'));
    expect(confirm.getByText('Disconnect WhatsApp?')).toBeTruthy();
    fireEvent.click(confirm.getByRole('button', { name: 'Disconnect' }));
    await waitFor(() =>
      expect(fake.capabilities.disconnect).toHaveBeenCalledWith(3)
    );
    fake.setAccount(null);
    expect(
      await screen.findByText(/remove Macro under WhatsApp → Linked devices/)
    ).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Connect' })).toBeTruthy();
  });

  it('adds a group in one click, without a dialog', async () => {
    const fake = createFakeWhatsApp({
      account: { generation: 3, phone: '+14155550142', health: 'connected' },
      groups,
    });
    mount(fake);

    fireEvent.click(screen.getByRole('button', { name: 'Add to Macro' }));
    await waitFor(() =>
      expect(fake.capabilities.adopt).toHaveBeenCalledWith('120363003@g.us')
    );
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('says exactly why adding failed, on the group it failed for', async () => {
    const fake = createFakeWhatsApp({
      account: { generation: 3, phone: '+14155550142', health: 'connected' },
      groups,
    });
    fake.capabilities.adopt.mockReturnValueOnce(
      errAsync({ kind: 'adopt-failed', reason: 'disconnected' })
    );
    mount(fake);

    fireEvent.click(screen.getByRole('button', { name: 'Add to Macro' }));
    const row = within(
      screen.getByText('Launch War Room').closest('li') as HTMLElement
    );
    expect((await row.findByRole('alert')).textContent).toBe(
      'Your WhatsApp is disconnected. Reconnect it, then add the group.'
    );
    expect(row.getByRole('button', { name: 'Add to Macro' })).toBeTruthy();
  });
});

describe('passkey', () => {
  it('answers WhatsApp’s passkey on desktop, then shows the code that comes back', async () => {
    const authenticate = vi.fn(
      (
        _pairingId: string,
        _challenge: Record<string, unknown>,
        onEvent: (event: { type: 'qr'; value: string }) => void
      ) => {
        onEvent({ type: 'qr', value: 'FIDO:/0123456789' });
        return okAsync(undefined);
      }
    );
    const fake = createFakeWhatsApp({
      account: null,
      passkey: { kind: 'native', authenticate },
    });
    mount(fake);
    fireEvent.click(screen.getByRole('button', { name: 'Connect' }));
    const dialog = within(await screen.findByRole('dialog'));
    fake.setPairing({ kind: 'passkey', challenge: { rpId: 'whatsapp.com' } });

    expect(dialog.getByText('Confirm on your desktop')).toBeTruthy();
    fireEvent.click(
      dialog.getByRole('button', { name: 'Confirm with passkey' })
    );
    await waitFor(() =>
      expect(authenticate).toHaveBeenCalledWith(
        'pairing-1',
        { rpId: 'whatsapp.com' },
        expect.any(Function)
      )
    );

    fake.setPairing({ kind: 'code', code: 'ABCD-EFGH' });
    expect(await dialog.findByText('ABCD-EFGH')).toBeTruthy();
  });

  it('explains a failed passkey and lets the person try again', async () => {
    const fake = createFakeWhatsApp({
      account: null,
      passkey: {
        kind: 'native',
        authenticate: () =>
          errAsync({
            kind: 'passkey-failed',
            message:
              'Your phone did not verify you. Unlock your phone and try again.',
          }),
      },
    });
    mount(fake);
    fireEvent.click(screen.getByRole('button', { name: 'Connect' }));
    const dialog = within(await screen.findByRole('dialog'));
    fake.setPairing({ kind: 'passkey', challenge: { rpId: 'whatsapp.com' } });
    fireEvent.click(
      dialog.getByRole('button', { name: 'Confirm with passkey' })
    );
    expect(
      await dialog.findByText(/Your phone did not verify you/)
    ).toBeTruthy();
    expect(dialog.getByRole('button', { name: 'Try again' })).toBeTruthy();
  });

  it('hands a browser pairing to Macro desktop by id and keeps it alive on close', async () => {
    const fake = createFakeWhatsApp({ account: null });
    mount(fake);
    fireEvent.click(screen.getByRole('button', { name: 'Connect' }));
    const dialog = within(await screen.findByRole('dialog'));
    fake.setPairing({ kind: 'passkey', challenge: { rpId: 'whatsapp.com' } });

    const link = dialog.getByRole('link', {
      name: 'Continue in Macro desktop',
    });
    expect(link.getAttribute('href')).toBe(
      'macro:///external?whatsappPairing=pairing-1'
    );
    link.addEventListener('click', (event) => event.preventDefault());
    fireEvent.click(link);
    fireEvent.click(dialog.getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(dialogOpen()).toBe(false));
    expect(fake.capabilities.cancelPairing).not.toHaveBeenCalled();
  });

  it('opens a handed-off pairing at once in desktop', async () => {
    const fake = createFakeWhatsApp({ account: null });
    mount(fake, '01920000-0000-7000-8000-000000000009');
    expect(await screen.findByText('Link WhatsApp')).toBeTruthy();
    const pairingId = fake.capabilities.pairing.mock.calls[0]?.[0];
    expect(pairingId?.()).toBe('01920000-0000-7000-8000-000000000009');
    expect(fake.capabilities.connect).not.toHaveBeenCalled();
  });
});
