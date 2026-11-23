import type { MessageParent } from '@service-storage/messages';
import { createRoot, createSignal } from 'solid-js';
import { beforeEach, expect, it, vi } from 'vitest';
import { useMessageParticipants } from './use-message-participants';

const team = vi.hoisted(() => ({ pending: false }));
beforeEach(() => {
  team.pending = false;
});

vi.mock('./use-channel-participants', () => ({
  useChannelParticipants: (channelId: () => string) => ({
    users: () =>
      channelId()
        ? [{ id: 'macro|member@example.com', email: '', name: 'Member' }]
        : [],
    ids: () => [],
  }),
}));
vi.mock('@queries/team/teams', () => ({
  useCurrentTeamQuery: () => ({
    get isPending() {
      return team.pending;
    },
    data: {
      members: [
        { user_id: 'macro|seller@example.com' },
        { user_id: 'macro|owner@example.com' },
      ],
    },
  }),
}));

it('does not widen a pending CRM roster into the personal directory', () => {
  team.pending = true;
  createRoot((dispose) => {
    try {
      const participants = useMessageParticipants(() => ({
        type: 'crm_contact',
        id: 'record',
      }));
      expect(participants()).toEqual([]);
    } finally {
      dispose();
    }
  });
});

it('keeps CRM/channel rosters scoped and delegates discussion people to bounded search', () => {
  createRoot((dispose) => {
    const [parent, setParent] = createSignal<MessageParent>({
      type: 'crm_company',
      id: 'company',
    });
    const participants = useMessageParticipants(parent);
    const ids = () => participants()?.map((user) => user.id);

    expect(ids()).toEqual([
      'macro|seller@example.com',
      'macro|owner@example.com',
    ]);
    expect(participants()?.[0].email).toBe('seller@example.com');

    setParent({ type: 'crm_contact', id: 'contact' });
    expect(ids()).toEqual([
      'macro|seller@example.com',
      'macro|owner@example.com',
    ]);

    setParent({ type: 'document', id: 'document' });
    expect(participants()).toBeUndefined();

    setParent({ type: 'call', id: 'call' });
    expect(participants()).toBeUndefined();
    setParent({ type: 'initiative', id: 'project' });
    expect(participants()).toBeUndefined();

    setParent({ type: 'channel', id: 'channel' });
    expect(ids()).toEqual(['macro|member@example.com']);
    dispose();
  });
});
