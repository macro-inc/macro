import { beforeEach, expect, it, vi } from 'vitest';
import { useSendMessageToPeople } from './channels';
import { ThrownResultError } from './result';

const mocks = vi.hoisted(() => ({
  send: vi.fn(),
  direct: vi.fn(),
  group: vi.fn(),
  goTo: vi.fn(),
}));
vi.mock('@block-channel/constants', () => ({
  URL_PARAMS: { message: 'message' },
}));
vi.mock('@components/app/GlobalAppState', () => ({
  useGlobalBlockOrchestrator: () => ({
    getBlockHandle: async () => ({ goToLocationFromParams: mocks.goTo }),
  }),
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

function postedIds() {
  return mocks.send.mock.calls.map(([vars]) => vars.optimisticId);
}

it('posts under a supplied id and opens the stored message', async () => {
  const { sendToChannel } = useSendMessageToPeople();
  mocks.send.mockResolvedValue({ id: 'server-1' });

  const sent = await sendToChannel({
    channelId: 'channel',
    content: 'Have a look',
    mentions: [],
    messageId: 'planned-1',
  });
  await sent?.navigateToChannel();

  expect(postedIds()).toEqual(['planned-1']);
  expect(sent?.messageId).toBe('server-1');
  expect(mocks.goTo.mock.calls).toEqual([[{ message: 'server-1' }]]);
});

it('mints a message id when none is supplied', async () => {
  const { sendToChannel } = useSendMessageToPeople();

  await sendToChannel({ channelId: 'channel', content: '', mentions: [] });

  expect(postedIds()).toEqual(['019f694c-d7c0-7000-8000-000000000001']);
});

it('counts a conflict on a supplied id as delivered', async () => {
  const { sendToUsers } = useSendMessageToPeople();
  mocks.send.mockRejectedValue(
    new ThrownResultError([
      { code: 'CONFLICT', message: 'message id already exists' },
    ])
  );

  const sent = await sendToUsers({
    users: ['recipient'],
    content: '',
    mentions: [],
    messageId: 'planned-1',
  });
  await sent?.navigateToChannel();

  expect(sent?.channelId).toBe('resolved-dm');
  expect(sent?.messageId).toBe('planned-1');
  expect(mocks.goTo.mock.calls).toEqual([[{ message: 'planned-1' }]]);
});

it.each([
  {
    failure: 'a conflict on a minted id',
    messageId: undefined,
    code: 'CONFLICT',
  },
  { failure: 'any other error', messageId: 'planned-1', code: 'SERVER_ERROR' },
])('fails on $failure', async ({ messageId, code }) => {
  const { sendToChannel } = useSendMessageToPeople();
  mocks.send.mockRejectedValue(
    new ThrownResultError([{ code, message: code }])
  );

  const sent = await sendToChannel({
    channelId: 'channel',
    content: '',
    mentions: [],
    messageId,
  });

  expect(postedIds()).toEqual([
    messageId ?? '019f694c-d7c0-7000-8000-000000000001',
  ]);
  expect(sent).toBeUndefined();
});
