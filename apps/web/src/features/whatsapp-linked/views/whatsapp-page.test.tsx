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
    group: { id: 'channel-design', name: 'design-crit' },
    unsupported: undefined,
  },
  {
    jid: '120363003@g.us',
    name: 'Launch War Room',
    memberCount: 23,
    group: undefined,
    unsupported: undefined,
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

  it('lists groups, opens adopted groups, and disconnects after confirming', async () => {
    const fake = createFakeWhatsApp({
      account: { generation: 3, phone: '+14155550142', health: 'connected' },
      groups,
    });
    mount(fake);

    expect(screen.getByText('+14155550142')).toBeTruthy();
    expect(screen.getByText('Connected · linked device')).toBeTruthy();
    expect(fake.groupsEnabled[0]?.()).toBe(true);
    const list = within(
      screen.getByRole('list', { name: 'Your WhatsApp groups' })
    );
    expect(list.getByText('14 members')).toBeTruthy();
    fireEvent.click(list.getByRole('button', { name: /In Macro/ }));
    expect(fake.capabilities.openGroup).toHaveBeenCalledWith('channel-design');

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

  it('adds a group with a name and owner-only access', async () => {
    const fake = createFakeWhatsApp({
      account: { generation: 3, phone: '+14155550142', health: 'connected' },
      groups,
    });
    mount(fake);

    fireEvent.click(screen.getByRole('button', { name: 'Add to Macro' }));
    const dialog = within(await screen.findByRole('dialog'));
    expect(dialog.getByText('Add “Launch War Room” to Macro')).toBeTruthy();
    const name = dialog.getByLabelText('Group name') as HTMLInputElement;
    expect(name.value).toBe('Launch War Room');
    expect(dialog.queryByRole('checkbox')).toBeNull();
    expect(dialog.getByText(/Only you have access at first/)).toBeTruthy();
    expect(
      dialog.getByText(/Each person replies from their own WhatsApp/)
    ).toBeTruthy();

    fireEvent.input(name, { target: { value: 'war-room' } });
    fireEvent.click(dialog.getByRole('button', { name: 'Add group' }));
    await waitFor(() =>
      expect(fake.capabilities.adopt).toHaveBeenCalledWith({
        groupJid: '120363003@g.us',
        name: 'war-room',
      })
    );
    await waitFor(() =>
      expect(screen.queryByText('Add “Launch War Room” to Macro')).toBeNull()
    );
  });

  it('keeps the dialog open with an explanation when adding fails', async () => {
    const fake = createFakeWhatsApp({
      account: { generation: 3, phone: '+14155550142', health: 'connected' },
      groups,
    });
    fake.capabilities.adopt.mockReturnValueOnce(
      errAsync({ kind: 'request-failed' })
    );
    mount(fake);

    fireEvent.click(screen.getByRole('button', { name: 'Add to Macro' }));
    const dialog = within(await screen.findByRole('dialog'));
    fireEvent.click(dialog.getByRole('button', { name: 'Add group' }));
    expect(await dialog.findByText(/Couldn't add this group/)).toBeTruthy();
    expect(screen.getByRole('dialog')).toBeTruthy();
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

it('opens a shared group before the viewer connects WhatsApp', () => {
  const fake = createFakeWhatsApp({
    account: null,
    sharedGroups: [
      { id: 'shared-group', name: 'Shared Design Crit', unreadCount: 3 },
    ],
  });
  mount(fake);
  expect(screen.getByLabelText('3 unread messages')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: /Shared Design Crit/ }));
  expect(fake.capabilities.openGroup).toHaveBeenCalledWith('shared-group');
  expect(fake.capabilities.connect).not.toHaveBeenCalled();
});
