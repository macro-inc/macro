import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@solidjs/testing-library';
import { errAsync, okAsync, ResultAsync } from 'neverthrow';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WhatsAppLinkedProvider } from '../context/whatsapp-linked-context';
import { AUTO_ROLLS } from '../primitives/pairing-flow';
import { createFakeWhatsApp } from '../tests/fake-capabilities';
import { WhatsAppPage } from './whatsapp-page';

vi.mock('@core/mobile/isMobile', () => ({ isMobile: () => false }));
const toast = vi.hoisted(() => ({ success: vi.fn(), failure: vi.fn() }));
vi.mock('@core/component/Toast/Toast', () => ({ toast }));

function setTabVisibility(state: DocumentVisibilityState) {
  Object.defineProperty(document, 'visibilityState', {
    configurable: true,
    get: () => state,
  });
  document.dispatchEvent(new Event('visibilitychange'));
}

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
  setTabVisibility('visible');
  vi.clearAllMocks();
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

const launch = (announcements: boolean) => ({
  id: '120363000000000010@g.us',
  name: 'Launch',
  announcements,
});

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
    cannotAddReason: 'own_chat' as const,
  },
  {
    ...chat,
    jid: '120363001@g.us',
    name: 'Design Crit',
    lastActivityAt: '2025-03-06T10:00:00Z',
    inMacro: { kind: 'own' as const, chatId: 'group-design' },
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
      chatId: 'group-family',
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
    cannotAddReason: 'community' as const,
  },
];

describe('not connected', () => {
  it('links WhatsApp through a QR dialog', async () => {
    const fake = createFakeWhatsApp({ account: null });
    mount(fake);

    expect(screen.queryByText(/unofficial|ban accounts/i)).toBeNull();
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
    // WhatsApp rotates the code within one pairing; the dialog follows it.
    const firstCode = dialog.getByRole('img').innerHTML;
    fake.setPairing({ kind: 'scan', qr: '2@rotated-ref,key,identity,adv' });
    expect(dialog.getByRole('img').innerHTML).not.toBe(firstCode);

    fireEvent.click(dialog.getByRole('button', { name: 'Cancel' }));
    await waitFor(() =>
      expect(fake.capabilities.cancelPairing).toHaveBeenCalledWith('pairing-1')
    );
    await waitFor(() => expect(dialogOpen()).toBe(false));
  });

  it('replaces an expired code with a new pairing without a click', async () => {
    const fake = createFakeWhatsApp({ account: null });
    mount(fake);
    fireEvent.click(screen.getByRole('button', { name: 'Connect' }));
    const dialog = within(await screen.findByRole('dialog'));
    fake.setPairing({ kind: 'scan', qr: '2@first-ref' });

    fake.setPairing({ kind: 'expired' });
    expect(dialog.getByText('Refreshing code…')).toBeTruthy();
    expect(dialog.queryByText('Code expired')).toBeNull();
    expect(dialog.queryByRole('alert')).toBeNull();
    await waitFor(() =>
      expect(fake.capabilities.connect).toHaveBeenCalledTimes(2)
    );
    expect(dialog.getByText('Refreshing code…')).toBeTruthy();
    expect(dialog.getByText('Tap Link a device')).toBeTruthy();

    fake.setPairing({ kind: 'scan', qr: '2@second-ref' });
    expect(
      await dialog.findByRole('img', {
        name: 'Scan this code with WhatsApp on your phone',
      })
    ).toBeTruthy();
    expect(fake.capabilities.cancelPairing).not.toHaveBeenCalled();
  });

  it('asks for a click once it has rolled enough codes without a scan', async () => {
    const fake = createFakeWhatsApp({ account: null });
    mount(fake);
    fireEvent.click(screen.getByRole('button', { name: 'Connect' }));
    const dialog = within(await screen.findByRole('dialog'));
    for (let roll = 1; roll <= AUTO_ROLLS; roll++) {
      fake.setPairing({ kind: 'scan', qr: `2@ref-${roll}` });
      fake.setPairing({ kind: 'expired' });
      await waitFor(() =>
        expect(fake.capabilities.connect).toHaveBeenCalledTimes(roll + 1)
      );
    }
    fake.setPairing({ kind: 'scan', qr: '2@last-ref' });
    fake.setPairing({ kind: 'expired' });

    expect(await dialog.findByText('Code expired')).toBeTruthy();
    expect(dialog.queryByRole('img')).toBeNull();
    expect(dialog.getByText('Tap Link a device')).toBeTruthy();
    expect(fake.capabilities.connect).toHaveBeenCalledTimes(AUTO_ROLLS + 1);

    fireEvent.click(dialog.getByRole('button', { name: 'Show a new code' }));
    await waitFor(() =>
      expect(fake.capabilities.connect).toHaveBeenCalledTimes(AUTO_ROLLS + 2)
    );
    // A click starts a fresh run of automatic codes.
    fake.setPairing({ kind: 'scan', qr: '2@clicked-ref' });
    fake.setPairing({ kind: 'expired' });
    await waitFor(() =>
      expect(fake.capabilities.connect).toHaveBeenCalledTimes(AUTO_ROLLS + 3)
    );
  });

  it('does not roll a code that expired while the tab was hidden', async () => {
    vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] });
    vi.setSystemTime(new Date('2026-10-20T12:00:00.000Z'));
    const fake = createFakeWhatsApp({ account: null });
    mount(fake);
    fireEvent.click(screen.getByRole('button', { name: 'Connect' }));
    const dialog = within(await screen.findByRole('dialog'));
    fake.setPairing({ kind: 'scan', qr: '2@pairing-ref' });

    setTabVisibility('hidden');
    // The local deadline passes while nobody watches; the poll is paused.
    vi.advanceTimersByTime(53_000);
    expect(dialog.getByText('Code expired')).toBeTruthy();
    setTabVisibility('visible');
    fake.setPairing({ kind: 'expired' });
    expect(dialog.getByText('Code expired')).toBeTruthy();
    expect(fake.capabilities.connect).toHaveBeenCalledOnce();

    fireEvent.click(dialog.getByRole('button', { name: 'Show a new code' }));
    await waitFor(() =>
      expect(fake.capabilities.connect).toHaveBeenCalledTimes(2)
    );
  });

  it('waits for the server before rolling a code whose local deadline passed', async () => {
    vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] });
    vi.setSystemTime(new Date('2026-10-20T12:00:00.000Z'));
    const fake = createFakeWhatsApp({ account: null });
    mount(fake);
    fireEvent.click(screen.getByRole('button', { name: 'Connect' }));
    const dialog = within(await screen.findByRole('dialog'));
    fake.setPairing({ kind: 'scan', qr: '2@pairing-ref' });

    vi.advanceTimersByTime(53_000);
    expect(dialog.getByText('Refreshing code…')).toBeTruthy();
    expect(dialog.queryByRole('img')).toBeNull();
    expect(fake.capabilities.connect).toHaveBeenCalledOnce();
    fake.setPairing({ kind: 'expired' });
    await waitFor(() =>
      expect(fake.capabilities.connect).toHaveBeenCalledTimes(2)
    );
  });

  it('shows a real failure instead of rolling', async () => {
    const fake = createFakeWhatsApp({ account: null });
    mount(fake);
    fireEvent.click(screen.getByRole('button', { name: 'Connect' }));
    const dialog = within(await screen.findByRole('dialog'));
    fake.setPairing({ kind: 'scan', qr: '2@pairing-ref' });

    fake.setPairing({ kind: 'failed' });
    expect(dialog.getByRole('alert').textContent).toBe(
      "Linking didn't finish."
    );
    expect(fake.capabilities.connect).toHaveBeenCalledOnce();
    fireEvent.click(dialog.getByRole('button', { name: 'Show a new code' }));
    await waitFor(() =>
      expect(fake.capabilities.connect).toHaveBeenCalledTimes(2)
    );
  });

  it('says in the dialog when a new code could not be started', async () => {
    const fake = createFakeWhatsApp({ account: null });
    mount(fake);
    fireEvent.click(screen.getByRole('button', { name: 'Connect' }));
    const dialog = within(await screen.findByRole('dialog'));
    fake.setPairing({ kind: 'failed' });
    fake.capabilities.connect.mockReturnValueOnce(
      errAsync({ kind: 'request-failed' })
    );

    fireEvent.click(dialog.getByRole('button', { name: 'Show a new code' }));
    expect(
      await dialog.findByText("Couldn't get a new code. Try again.")
    ).toBeTruthy();
    fireEvent.click(dialog.getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(dialogOpen()).toBe(false));
    expect(
      screen.queryByText("Couldn't start linking WhatsApp. Try again.")
    ).toBeNull();
  });

  it('cancels the next pairing when the dialog closes while it is starting', async () => {
    const fake = createFakeWhatsApp({ account: null });
    mount(fake);
    fireEvent.click(screen.getByRole('button', { name: 'Connect' }));
    const dialog = within(await screen.findByRole('dialog'));
    fake.setPairing({ kind: 'scan', qr: '2@pairing-ref' });
    let resolveNext!: (pairing: {
      pairingId: string;
      expiresAt: string;
    }) => void;
    fake.capabilities.connect.mockReturnValueOnce(
      ResultAsync.fromSafePromise(
        new Promise((resolve) => {
          resolveNext = resolve;
        })
      )
    );

    fake.setPairing({ kind: 'expired' });
    await waitFor(() =>
      expect(fake.capabilities.connect).toHaveBeenCalledTimes(2)
    );
    fireEvent.click(dialog.getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(dialogOpen()).toBe(false));
    resolveNext({
      pairingId: 'pairing-2',
      expiresAt: new Date(Date.now() + 52_000).toISOString(),
    });
    await waitFor(() =>
      expect(fake.capabilities.cancelPairing).toHaveBeenCalledWith('pairing-2')
    );
    expect(dialogOpen()).toBe(false);
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
    expect(screen.queryByText('Design Crit')).toBeNull();
    // Only sections with chats show: no direct chat here can be added.
    expect(screen.queryByRole('list', { name: 'Direct messages' })).toBeNull();
    const list = within(screen.getByRole('list', { name: 'Groups' }));
    expect(list.getAllByRole('listitem').map((row) => row.textContent)).toEqual(
      [
        'Launch War RoomGroupAdd to MacroMar 5, 2025',
        'Ana, Ben, +2GroupShared with you by Ana SilvaOpen',
      ]
    );
    fireEvent.click(
      list.getByRole('button', { name: /shared with you by Ana Silva/i })
    );
    expect(fake.capabilities.openChat).toHaveBeenCalledWith('group-family');

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
    expect(
      direct.getByText("Your chat with yourself can't be added")
    ).toBeTruthy();
    expect(direct.queryByRole('button')).toBeNull();
    expect(
      unsupported.getByText(
        'A community has no messages of its own; add one of its groups'
      )
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
    await waitFor(() =>
      expect(toast.success).toHaveBeenCalledWith(
        'Disconnected in Macro. To finish, remove Macro under WhatsApp → Linked devices on your phone.'
      )
    );
    fake.setAccount(null);
    expect(screen.getByRole('button', { name: 'Connect' })).toBeTruthy();

    // Linking again leaves nothing of the disconnect on the page.
    fake.setAccount({
      generation: 4,
      phone: '+14155550142',
      health: 'connected',
    });
    expect(await screen.findByText('Connected')).toBeTruthy();
    expect(screen.queryByText(/Linked devices on your phone/)).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
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
          cannotAddReason: 'not_in_chat_list' as const,
        },
      ],
    });
    mount(fake);

    const search = screen.getByRole('searchbox', {
      name: 'Search WhatsApp chats',
    });
    // A folded section still shows what a search finds in it.
    fireEvent.click(screen.getByRole('button', { name: 'Groups' }));
    expect(fake.capabilities.sections.isOpen('groups')).toBe(false);
    fireEvent.input(search, { target: { value: 'design' } });
    const found = within(screen.getByRole('list', { name: 'Groups' }));
    fireEvent.click(found.getByRole('button', { name: 'Open' }));
    expect(fake.capabilities.openChat).toHaveBeenCalledWith('group-design');

    fireEvent.input(search, { target: { value: 'ana' } });
    const list = within(screen.getByRole('list', { name: 'Groups' }));
    expect(list.getByText('Ana, Ben, +2')).toBeTruthy();
    expect(list.queryByText('Launch War Room')).toBeNull();
    expect(list.queryByText('Design Crit')).toBeNull();
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
      expect(fake.capabilities.add).toHaveBeenCalledWith(
        expect.objectContaining({ jid: '120363003@g.us', kind: 'group' })
      )
    );
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('adds a direct chat like a group', async () => {
    const fake = createFakeWhatsApp({
      account: { generation: 3, phone: '+14155550142', health: 'connected' },
      chats: [
        {
          ...chat,
          jid: '15550001111@s.whatsapp.net',
          kind: 'direct' as const,
          name: 'Ben Ode',
        },
      ],
    });
    mount(fake);
    const row = within(
      within(screen.getByRole('list', { name: 'Direct messages' }))
        .getByText('Ben Ode')
        .closest('li') as HTMLElement
    );
    expect(row.getByText('Direct chat')).toBeTruthy();
    fireEvent.click(row.getByRole('button', { name: 'Add to Macro' }));
    await waitFor(() =>
      expect(fake.capabilities.add).toHaveBeenCalledWith(
        expect.objectContaining({
          jid: '15550001111@s.whatsapp.net',
          kind: 'direct',
        })
      )
    );
  });

  it('lists direct chats, groups and each community apart, recent first, and offers them all', async () => {
    const fake = createFakeWhatsApp({
      account: { generation: 3, phone: '+14155550142', health: 'connected' },
      chats: [
        {
          ...chat,
          jid: '120363010@g.us',
          name: 'Design',
          community: launch(false),
        },
        {
          ...chat,
          jid: '120363011@g.us',
          name: 'Launch',
          community: launch(true),
        },
        {
          ...chat,
          jid: '14155550177@s.whatsapp.net',
          kind: 'direct' as const,
          name: 'Ben Ode',
        },
        {
          ...chat,
          jid: '120363020@g.us',
          name: 'Kitchen',
          community: {
            id: '120363000000000020@g.us',
            name: 'Building',
            announcements: false,
          },
        },
        // Disappearing messages no longer keep a group out.
        { ...chat, jid: '120363012@g.us', name: 'Night shift' },
        {
          ...chat,
          jid: '120363013@g.us',
          name: 'Launch',
          canAdd: false,
          cannotAddReason: 'community' as const,
        },
      ],
    });
    mount(fake);
    const names = (label: string) =>
      within(screen.getByRole('list', { name: label }))
        .getAllByRole('listitem')
        .map((row) => row.querySelector('.font-medium')?.textContent);
    expect(names('Direct messages')).toEqual(['Ben Ode']);
    expect(names('Groups')).toEqual(['Night shift']);
    // One section per community, by its latest group; groups by their own name.
    expect(names('Launch')).toEqual(['Design', 'Announcements']);
    expect(names('Building')).toEqual(['Kitchen']);
    expect(
      screen
        .getAllByRole('button', { expanded: true })
        .map((trigger) => trigger.textContent)
    ).toEqual([
      'Direct messages',
      'Groups',
      'Communities',
      'Launch',
      'Building',
    ]);
    const launchList = within(screen.getByRole('list', { name: 'Launch' }));
    const design = within(
      launchList.getByText('Design').closest('li') as HTMLElement
    );
    expect(design.getByText('Community group')).toBeTruthy();
    expect(launchList.getByText('Announcement group')).toBeTruthy();
    expect(
      screen.getAllByRole('button', { name: 'Add to Macro' })
    ).toHaveLength(5);

    // Folding a community is remembered.
    fireEvent.click(screen.getByRole('button', { name: 'Building' }));
    expect(
      fake.capabilities.sections.isOpen('community:120363000000000020@g.us')
    ).toBe(false);
    fireEvent.click(
      screen.getByRole('button', { name: /Can't be added \(1\)/ })
    );
    expect(
      within(screen.getByRole('list', { name: "Can't be added" })).getByText(
        'A community has no messages of its own; add one of its groups'
      )
    ).toBeTruthy();
    // Searching the community finds its groups, and only them.
    fireEvent.input(
      screen.getByRole('searchbox', { name: 'Search WhatsApp chats' }),
      {
        target: { value: 'launch' },
      }
    );
    expect(names('Launch')).toEqual(['Design', 'Announcements']);
    expect(screen.queryByRole('list', { name: 'Groups' })).toBeNull();
    expect(screen.queryByRole('list', { name: 'Building' })).toBeNull();
  });

  it('says exactly why adding failed, on the group it failed for', async () => {
    const fake = createFakeWhatsApp({
      account: { generation: 3, phone: '+14155550142', health: 'connected' },
      chats,
    });
    fake.capabilities.add.mockReturnValueOnce(
      errAsync({ kind: 'add-failed', reason: 'disconnected' })
    );
    mount(fake);

    fireEvent.click(screen.getByRole('button', { name: 'Add to Macro' }));
    const row = within(
      screen.getByText('Launch War Room').closest('li') as HTMLElement
    );
    expect((await row.findByRole('alert')).textContent).toBe(
      'Your WhatsApp is disconnected. Reconnect it, then add the chat.'
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

  it('says a handed-off pairing that cannot be read did not finish, and offers a new code', async () => {
    const fake = createFakeWhatsApp({ account: null });
    mount(fake, '01920000-0000-7000-8000-000000000009');
    const dialog = within(await screen.findByRole('dialog'));
    expect(dialog.getByText('Preparing code…')).toBeTruthy();

    fake.failPairingRead('01920000-0000-7000-8000-000000000009');
    expect(dialog.getByRole('alert').textContent).toBe(
      "Linking didn't finish."
    );
    fireEvent.click(dialog.getByRole('button', { name: 'Show a new code' }));
    await waitFor(() =>
      expect(fake.capabilities.connect).toHaveBeenCalledOnce()
    );
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
