import { beforeEach, expect, it, onTestFinished, vi } from 'vitest';
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

it.each([
  { users: ['recipient'], channelId: 'resolved-dm' },
  { users: ['recipient', 'other'], channelId: 'resolved-group' },
])(
  'resolves $users to $channelId and posts the attachments there',
  async ({ users, channelId }) => {
    const { resolvePeopleChannel, sendToUsers } = useSendMessageToPeople();

    const resolved = await resolvePeopleChannel(users);
    const sent = await sendToUsers({
      users,
      content: '',
      mentions: [],
      attachments: [{ entity_type: 'initiative', entity_id: 'project' }],
    });

    expect([resolved, sent?.channelId]).toEqual([channelId, channelId]);
    expect(mocks.send.mock.calls[0][0]).toMatchObject({
      parent: { type: 'channel', id: channelId },
      message: {
        attachments: [{ entity_type: 'initiative', entity_id: 'project' }],
      },
    });
  }
);

it('resolves a failed lookup to nothing and posts nothing', async () => {
  const logError = vi.spyOn(console, 'error').mockImplementation(() => {});
  onTestFinished(() => logError.mockRestore());
  mocks.direct.mockRejectedValue(new Error('unavailable'));
  const { resolvePeopleChannel, sendToUsers } = useSendMessageToPeople();

  const resolved = await resolvePeopleChannel(['recipient']);
  const sent = await sendToUsers({
    users: ['recipient'],
    content: '',
    mentions: [],
  });

  expect([resolved, sent]).toEqual([undefined, undefined]);
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

it('resolves a failed send to nothing', async () => {
  const { sendToChannel } = useSendMessageToPeople();
  mocks.send.mockRejectedValue(
    new ThrownResultError([{ code: 'SERVER_ERROR', message: 'unavailable' }])
  );

  const sent = await sendToChannel({
    channelId: 'channel',
    content: '',
    mentions: [],
    messageId: 'planned-1',
  });

  expect(postedIds()).toEqual(['planned-1']);
  expect(sent).toBeUndefined();
});
