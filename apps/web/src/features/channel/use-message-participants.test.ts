import type { MessageParent } from '@service-storage/messages';
import { createRoot, createSignal } from 'solid-js';
import { expect, it, vi } from 'vitest';
import { useMessageParticipants } from './use-message-participants';

vi.mock('./use-channel-participants', () => ({
  useChannelParticipants: (channelId: () => string) => ({
    users: () =>
      channelId()
        ? [{ id: 'macro|member@example.com', email: '', name: 'Member' }]
        : [],
    ids: () => [],
  }),
}));
vi.mock('@queries/contacts/contacts', () => ({
  useContacts: () => () => [
    { id: 'macro|contact@example.com', email: '', name: 'Contact' },
  ],
}));
vi.mock('@queries/team/teams', () => ({
  useCurrentTeamQuery: () => ({
    isPending: false,
    data: {
      members: [
        { user_id: 'macro|seller@example.com' },
        { user_id: 'macro|owner@example.com' },
      ],
    },
  }),
}));

it('offers the owning team on CRM records and contacts on documents', () => {
  createRoot((dispose) => {
    const [parent, setParent] = createSignal<MessageParent>({
      type: 'crm_company',
      id: 'company',
    });
    const participants = useMessageParticipants(parent);
    const ids = () => participants().map((user) => user.id);

    expect(ids()).toEqual([
      'macro|seller@example.com',
      'macro|owner@example.com',
    ]);
    expect(participants()[0].email).toBe('seller@example.com');

    setParent({ type: 'crm_contact', id: 'contact' });
    expect(ids()).toEqual([
      'macro|seller@example.com',
      'macro|owner@example.com',
    ]);

    setParent({ type: 'document', id: 'document' });
    expect(ids()).toEqual(['macro|contact@example.com']);

    setParent({ type: 'channel', id: 'channel' });
    expect(ids()).toEqual(['macro|member@example.com']);
    dispose();
  });
});
