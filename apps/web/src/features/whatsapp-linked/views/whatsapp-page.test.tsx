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

const chat = {
  kind: 'group' as const,
  lastActivityAt: undefined,
  archived: false,
  inMacro: undefined,
  canAdd: true,
  cannotAddReason: undefined,
};

/** DSS's order: newest activity first. */
const chats = [
  {
    ...chat,
    jid: '14155550199@s.whatsapp.net',
    kind: 'direct' as const,
    name: 'Ana Ruiz',
    lastActivityAt: '2025-03-07T10:00:00Z',
    canAdd: false,
    cannotAddReason: "direct chats can't be added to Macro yet",
  },
  {
    ...chat,
    jid: '120363001@g.us',
    name: 'Design Crit',
    lastActivityAt: '2025-03-06T10:00:00Z',
    inMacro: { kind: 'own' as const, groupId: 'group-design' },
    canAdd: false,
  },
  {
    ...chat,
    jid: '120363003@g.us',
    name: 'Launch War Room',
    lastActivityAt: '2025-03-05T10:00:00Z',
  },
  {
    ...chat,
    jid: '120363004@g.us',
    name: 'Ana, Ben, +2',
    inMacro: {
      kind: 'shared' as const,
      groupId: 'group-family',
      ownerId: 'macro|ana@example.test',
      ownerName: 'Ana Silva',
    },
    canAdd: false,
  },
  {
    ...chat,
    jid: '120363005@g.us',
    name: 'Neighbourhood',
    archived: true,
    canAdd: false,
    cannotAddReason: "community groups can't be added to Macro",
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
    expect(fake.chatsEnabled[0]?.()).toBe(false);

    fireEvent.click(screen.getByRole('button', { name: 'Connect' }));
    expect(fake.capabilities.connect).toHaveBeenCalledOnce();
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
  it('lists chats to add by recent activity, opens shared ones, and disconnects after confirming', async () => {
    const fake = createFakeWhatsApp({
      account: { generation: 3, phone: '+14155550142', health: 'connected' },
      chats,
    });
    mount(fake);

    expect(screen.getByText('+14155550142')).toBeTruthy();
    expect(screen.getByText('Connected')).toBeTruthy();
    expect(fake.chatsEnabled[0]?.()).toBe(true);
    // Added chats live in External's sidebar until a search finds them.
    expect(
      screen.queryByRole('list', { name: 'WhatsApp chats in Macro' })
    ).toBeNull();

    const list = within(
      screen.getByRole('list', { name: 'Groups to add to Macro' })
    );
    expect(list.queryByText('Design Crit')).toBeNull();
    expect(list.getAllByRole('listitem').map((row) => row.textContent)).toEqual(
      [
        'Launch War RoomGroupAdd to MacroMar 5, 2025',
        'Ana, Ben, +2GroupShared with you by Ana SilvaOpen',
      ]
    );
    fireEvent.click(
      list.getByRole('button', { name: /shared with you by Ana Silva/i })
    );
    expect(fake.capabilities.openGroup).toHaveBeenCalledWith('group-family');

    expect(screen.queryByText('Neighbourhood')).toBeNull();
    fireEvent.click(
      screen.getByRole('button', { name: /Can't be added \(2\)/ })
    );
    const unsupported = within(
      screen.getByRole('list', { name: "Can't be added" })
    );
    const direct = within(
      unsupported.getByText('Ana Ruiz').closest('li') as HTMLElement
    );
    expect(direct.getByText('Direct chat')).toBeTruthy();
    expect(direct.getByText('Mar 7, 2025')).toBeTruthy();
    expect(direct.getByText("Can't add direct chats yet")).toBeTruthy();
    expect(direct.queryByRole('button')).toBeNull();
    expect(
      unsupported.getByText("Community groups can't be added to Macro")
    ).toBeTruthy();
    expect(unsupported.getByText('Group · Archived')).toBeTruthy();

    fireEvent.keyDown(
      screen.getByRole('button', { name: 'WhatsApp account options' }),
      { key: 'Enter' }
    );
    fireEvent.keyDown(
      await screen.findByRole('menuitem', { name: 'Disconnect' }),
      { key: 'Enter' }
    );
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

  it('searches every section, added chats included, by name or phone digits', async () => {
    const fake = createFakeWhatsApp({
      account: { generation: 3, phone: '+14155550142', health: 'connected' },
      chats: [
        ...chats,
        {
          ...chat,
          jid: '14155550123@s.whatsapp.net',
          kind: 'direct' as const,
          name: '+1 415-555-0123',
          canAdd: false,
          cannotAddReason: "direct chats can't be added to Macro yet",
        },
      ],
    });
    mount(fake);

    const search = screen.getByRole('searchbox', {
      name: 'Search WhatsApp chats',
    });
    fireEvent.input(search, { target: { value: 'design' } });
    const inMacro = within(
      screen.getByRole('list', { name: 'WhatsApp chats in Macro' })
    );
    fireEvent.click(inMacro.getByRole('button', { name: 'Open' }));
    expect(fake.capabilities.openGroup).toHaveBeenCalledWith('group-design');

    fireEvent.input(search, { target: { value: 'ana' } });
    const list = within(
      screen.getByRole('list', { name: 'Groups to add to Macro' })
    );
    expect(list.getByText('Ana, Ben, +2')).toBeTruthy();
    expect(list.queryByText('Launch War Room')).toBeNull();
    expect(
      screen.queryByRole('list', { name: 'WhatsApp chats in Macro' })
    ).toBeNull();
    // Matches in the folded section show without unfolding it.
    expect(
      screen
        .getByRole('button', { name: /Can't be added \(1\)/ })
        .getAttribute('aria-expanded')
    ).toBe('true');
    expect(screen.getByText('Ana Ruiz')).toBeTruthy();

    fireEvent.input(search, { target: { value: '4155550123' } });
    expect(screen.getByText('+1 415-555-0123')).toBeTruthy();
    expect(screen.queryByText('Ana Ruiz')).toBeNull();

    fireEvent.input(search, { target: { value: 'nothing like it' } });
    expect(screen.getByText('No chats to add match your search.')).toBeTruthy();
  });

  it('adds a group in one click, without a dialog', async () => {
    const fake = createFakeWhatsApp({
      account: { generation: 3, phone: '+14155550142', health: 'connected' },
      chats,
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
      chats,
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
