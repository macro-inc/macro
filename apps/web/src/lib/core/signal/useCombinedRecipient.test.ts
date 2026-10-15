import { createRoot } from 'solid-js';
import { expect, it, vi } from 'vitest';
import { useCombinedRecipients } from './useCombinedRecipient';

const mocks = vi.hoisted(() => ({
  contacts: vi.fn(() => [
    { id: 'macro|ada@example.com', email: 'ada@example.com', name: 'Ada' },
  ]),
  channels: vi.fn(() => [
    { id: 'channel-1', participants: [{}, {}, {}] },
    { id: 'dm-1', participants: [{}, {}] },
  ]),
}));

vi.mock('@core/user', () => ({
  useContacts: () => mocks.contacts,
  useIsConnectedSecondaryInbox: () => () => false,
  recipientEntityMapper: (kind: string) => (data: { id: string }) => ({
    kind,
    id: data.id,
  }),
}));
vi.mock('@core/context/channels', () => ({
  useChannelsContext: () => ({ channels: mocks.channels }),
}));

it('projects recipients only once a picker reads them', () => {
  createRoot((dispose) => {
    const recipients = useCombinedRecipients();
    expect(mocks.contacts).not.toHaveBeenCalled();
    expect(mocks.channels).not.toHaveBeenCalled();

    expect(recipients.all()).toEqual([
      { kind: 'user', id: 'macro|ada@example.com' },
      { kind: 'channel', id: 'channel-1' },
    ]);
    dispose();
  });
});
