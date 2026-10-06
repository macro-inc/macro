import { beforeEach, expect, it, vi } from 'vitest';
import { useSendMessageToPeople } from './channels';

const mocks = vi.hoisted(() => ({
  send: vi.fn(),
  direct: vi.fn(),
  group: vi.fn(),
}));
vi.mock('@block-channel/constants', () => ({
  URL_PARAMS: { message: 'message' },
}));
vi.mock('@components/app/GlobalAppState', () => ({
  useGlobalBlockOrchestrator: () => ({ getBlockHandle: vi.fn() }),
}));
vi.mock('@components/app/split-layout/layout', () => ({
  useSplitLayout: () => ({ replaceSplit: vi.fn() }),
}));
vi.mock('@core/component/Toast/Toast', () => ({ toast: { failure: vi.fn() } }));
vi.mock('@core/context/user', () => ({ useUserId: () => () => 'owner' }));
vi.mock('@core/user/contactService', () => ({ invalidateContacts: vi.fn() }));
vi.mock('@queries/channel/channels', () => ({
  invalidateListChannels: vi.fn(),
}));
vi.mock('@queries/channel/get-or-create-dm', () => ({
  useGetOrCreateDirectMessageMutation: () => ({ mutateAsync: mocks.direct }),
  useGetOrCreatePrivateChannelMutation: () => ({ mutateAsync: mocks.group }),
}));
vi.mock('@queries/messages/mutations', () => ({
  newMessageId: () => '019f694c-d7c0-7000-8000-000000000001',
  useSendMessageMutation: () => ({ mutateAsync: mocks.send }),
}));
beforeEach(() => {
  vi.clearAllMocks();
  mocks.direct.mockResolvedValue({ channel_id: 'resolved-dm' });
  mocks.group.mockResolvedValue({ channel_id: 'resolved-group' });
  mocks.send.mockResolvedValue({ id: 'message' });
});

it.each([['recipient'], ['recipient', 'other']])(
  'authorizes the resolved destination before sending to %j',
  async (...users) => {
    const { sendToUsers } = useSendMessageToPeople();
    const order: string[] = [];
    const grant = vi.fn(async () => {
      order.push('grant');
    });
    mocks.send.mockImplementation(async () => {
      order.push('message');
      return { id: 'message' };
    });
    await sendToUsers({
      users,
      content: '',
      mentions: [],
      attachments: [{ entity_type: 'initiative', entity_id: 'project' }],
      beforeSend: grant,
    });
    expect(order).toEqual(['grant', 'message']);
    expect(grant).toHaveBeenCalledWith(
      users.length === 1 ? 'resolved-dm' : 'resolved-group'
    );
    expect(mocks.send.mock.calls[0][0].message.attachments).toEqual([
      { entity_type: 'initiative', entity_id: 'project' },
    ]);
  }
);

it('does not post an attachment when its destination grant fails', async () => {
  const { sendToChannel } = useSendMessageToPeople();
  await expect(
    sendToChannel({
      channelId: 'channel',
      content: '',
      mentions: [],
      attachments: [{ entity_type: 'initiative', entity_id: 'project' }],
      beforeSend: async () => {
        throw new Error('Only owner');
      },
    })
  ).rejects.toThrow('Only owner');
  expect(mocks.send).not.toHaveBeenCalled();
});
