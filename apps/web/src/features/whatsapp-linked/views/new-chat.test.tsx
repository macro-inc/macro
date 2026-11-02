import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@solidjs/testing-library';
import { errAsync } from 'neverthrow';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WhatsAppLinkedProvider } from '../context/whatsapp-linked-context';
import type { WhatsAppChat } from '../core/chat';
import { createFakeWhatsApp } from '../tests/fake-capabilities';
import { WhatsAppPage } from './whatsapp-page';

vi.mock('@core/mobile/isMobile', () => ({ isMobile: () => false }));
vi.mock('@core/component/Toast/Toast', () => ({
  toast: { success: vi.fn(), failure: vi.fn() },
}));

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
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

const direct = {
  kind: 'direct' as const,
  archived: false,
  inMacro: undefined,
  canAdd: true,
  cannotAddReason: undefined,
};

/** DSS's order: recent chats first, contacts nobody wrote to last. */
const chats: WhatsAppChat[] = [
  {
    ...direct,
    jid: 'ana',
    name: 'Ana Ruiz',
    phoneNumber: '+5550001',
    lastActivityAt: '2025-03-07T10:00:00Z',
  },
  {
    ...direct,
    jid: 'dana',
    name: 'Dana Smith',
    phoneNumber: '+5550002',
    lastActivityAt: undefined,
  },
  {
    ...direct,
    jid: 'eve',
    name: '+5550003',
    phoneNumber: '+5550003',
    lastActivityAt: undefined,
  },
];

function mount() {
  const fake = createFakeWhatsApp({
    account: { generation: 3, phone: '+5550009', health: 'connected' },
    chats,
  });
  render(() => (
    <WhatsAppLinkedProvider value={fake.capabilities}>
      <WhatsAppPage />
    </WhatsAppLinkedProvider>
  ));
  return fake;
}

describe('contacts', () => {
  it('lists saved contacts nobody wrote to below recent chats, with their numbers', () => {
    const fake = mount();
    const recent = within(
      screen.getByRole('list', { name: 'Direct messages' })
    );
    expect(recent.getAllByRole('listitem')).toHaveLength(1);
    const contacts = within(screen.getByRole('list', { name: 'Contacts' }));
    expect(
      contacts.getAllByRole('listitem').map((row) => row.textContent)
    ).toEqual([
      'Dana SmithDirect chat · +5550002Add to Macro',
      '+5550003Direct chatAdd to Macro',
    ]);

    fireEvent.click(
      contacts.getAllByRole('button', { name: 'Add to Macro' })[0]
    );
    expect(fake.capabilities.add).toHaveBeenCalledWith(chats[1]);
  });

  it('finds contacts by number', () => {
    mount();
    fireEvent.input(screen.getByRole('searchbox'), {
      target: { value: '555 0002' },
    });
    expect(screen.queryByRole('list', { name: 'Direct messages' })).toBeNull();
    expect(
      within(screen.getByRole('list', { name: 'Contacts' }))
        .getAllByRole('listitem')
        .map((row) => row.textContent)
    ).toEqual(['Dana SmithDirect chat · +5550002Add to Macro']);
  });
});

describe('new chat', () => {
  it('starts a chat with a typed number and opens it', async () => {
    const fake = mount();
    fireEvent.click(screen.getByRole('button', { name: 'New chat' }));
    const dialog = within(await screen.findByRole('dialog'));
    fireEvent.input(dialog.getByLabelText('Phone number'), {
      target: { value: '+555 000 7' },
    });
    fireEvent.click(dialog.getByRole('button', { name: 'Start chat' }));

    await waitFor(() =>
      expect(fake.capabilities.openChat).toHaveBeenCalledWith('chat-started')
    );
    expect(fake.capabilities.startChat).toHaveBeenCalledWith('+5550007');
  });

  it('says why a number did not start a chat and stays open', async () => {
    const fake = mount();
    fireEvent.click(screen.getByRole('button', { name: 'New chat' }));
    const dialog = within(await screen.findByRole('dialog'));
    const field = dialog.getByLabelText('Phone number');

    fireEvent.input(field, { target: { value: '555 0007' } });
    fireEvent.click(dialog.getByRole('button', { name: 'Start chat' }));
    expect(
      await dialog.findByText(
        'Enter the full number, starting with + and the country code.'
      )
    ).toBeTruthy();
    expect(fake.capabilities.startChat).not.toHaveBeenCalled();

    fake.capabilities.startChat.mockReturnValueOnce(
      errAsync({ reason: 'not-on-whatsapp', phoneNumber: '+5550007' })
    );
    fireEvent.input(field, { target: { value: '+5550007' } });
    fireEvent.click(dialog.getByRole('button', { name: 'Start chat' }));
    expect(await dialog.findByText("+5550007 isn't on WhatsApp.")).toBeTruthy();
    expect(fake.capabilities.openChat).not.toHaveBeenCalled();

    fake.capabilities.startChat.mockReturnValueOnce(
      errAsync({
        reason: 'lookup-refused',
        refusal: { reason: 'rate-limited' },
      })
    );
    fireEvent.click(dialog.getByRole('button', { name: 'Start chat' }));
    expect(
      await dialog.findByText(/looked up many numbers recently/)
    ).toBeTruthy();
  });
});
