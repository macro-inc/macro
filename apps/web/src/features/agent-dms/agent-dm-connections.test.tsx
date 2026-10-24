/** @vitest-environment jsdom */

import {
  AppConnectionContext,
  type ConnectingReply,
} from '@core/pipedream/connection-context';
import { cleanup, render } from '@solidjs/testing-library';
import { useContext } from 'solid-js';
import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  connect: vi.fn(),
  send: vi.fn(),
  alert: vi.fn(),
  refresh: vi.fn(async () => true),
  turns: [] as {
    state: string;
    createdAt: string;
    replyMessageId: string | null;
  }[],
}));

vi.mock('@queries/pipedream-connectors', () => ({
  connectPipedreamApp: mocks.connect,
}));
vi.mock('@queries/messages/mutations', () => ({
  newMessageId: () => 'message-1',
  useSendMessageMutation: () => ({ mutateAsync: mocks.send }),
}));
vi.mock('@core/context/user', () => ({
  useUserId: () => () => 'macro|ana@example.com',
}));
vi.mock('@core/component/Toast/Toast', () => ({
  toast: { alert: mocks.alert },
}));
vi.mock('@app/features/agent-conversations/context', () => ({
  useOptionalAgentConversations: () => ({
    conversations: () => [{ turns: mocks.turns }],
    refresh: mocks.refresh,
  }),
}));

import { AgentDmConnections, connectedMessage } from './agent-dm-connections';

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  mocks.turns = [];
});

function Probe(props: { onContext: (value: unknown) => void }) {
  props.onContext(useContext(AppConnectionContext));
  return null;
}

function mount(agentDm: boolean) {
  let context:
    | {
        connect: (
          app: { appSlug: string; name: string },
          reply?: ConnectingReply
        ) => Promise<void>;
        enabled?: () => boolean;
      }
    | undefined;
  render(() => (
    <AgentDmConnections channelId="channel-1" agentDm={agentDm}>
      <Probe onContext={(value) => (context = value as typeof context)} />
    </AgentDmConnections>
  ));
  if (!context) throw new Error('no context');
  return context;
}

const linear = { appSlug: 'linear', name: 'Linear' };
// Monday's reply asked for Linear. Message ids are UUIDv7, ordered by time.
const mondayReply: ConnectingReply = {
  messageId: '01a10b82-6f60-7000-8000-000000000001',
  postedAt: '2026-10-05T10:01:00Z',
};
const monday = {
  state: 'succeeded',
  createdAt: '2026-10-05T10:00:00Z',
  replyMessageId: mondayReply.messageId,
};
// On Wednesday the person asked something else.
const wednesday = {
  state: 'succeeded',
  createdAt: '2026-10-07T09:00:00Z',
  replyMessageId: '01a11598-38e0-7000-8000-000000000001',
};
const notResumed =
  'Linear connected. Send a message when you are ready to continue.';

describe('connecting an app in an agent DM', () => {
  it('connects in place, then tells the agent in the conversation', async () => {
    mocks.connect.mockResolvedValue('connected');
    mocks.turns = [monday];
    const context = mount(true);
    expect(context.enabled?.()).toBe(true);
    await context.connect(linear, mondayReply);
    expect(mocks.refresh).toHaveBeenCalledOnce();
    expect(mocks.connect).toHaveBeenCalledWith({
      appSlug: 'linear',
      serverName: 'Linear',
    });
    expect(mocks.send).toHaveBeenCalledWith({
      parent: { type: 'channel', id: 'channel-1' },
      senderId: 'macro|ana@example.com',
      optimisticId: 'message-1',
      message: { content: connectedMessage('Linear') },
    });
  });

  it('connects from an older reply without carrying on what was asked since', async () => {
    mocks.connect.mockResolvedValue('connected');
    mocks.turns = [monday, wednesday];
    await mount(true).connect(linear, mondayReply);
    expect(mocks.connect).toHaveBeenCalledOnce();
    expect(mocks.send).not.toHaveBeenCalled();
    expect(mocks.alert).toHaveBeenCalledWith(notResumed);
  });

  it('decides against what was asked while the sign-in was open', async () => {
    mocks.turns = [monday];
    let asked = false;
    mocks.connect.mockImplementationOnce(async () => {
      asked = true;
      return 'connected';
    });
    // Only a read made after the sign-in sees Wednesday's request.
    mocks.refresh.mockImplementationOnce(async () => {
      if (asked) mocks.turns = [monday, wednesday];
      return true;
    });
    await mount(true).connect(linear, mondayReply);
    expect(mocks.send).not.toHaveBeenCalled();
    expect(mocks.alert).toHaveBeenCalledWith(notResumed);
  });

  it('connects without carrying on when it cannot read the conversation again', async () => {
    mocks.connect.mockResolvedValue('connected');
    mocks.turns = [monday];
    mocks.refresh.mockResolvedValueOnce(false);
    await mount(true).connect(linear, mondayReply);
    expect(mocks.connect).toHaveBeenCalledOnce();
    expect(mocks.send).not.toHaveBeenCalled();
    expect(mocks.alert).toHaveBeenCalledWith(notResumed);
  });

  it('connects without interrupting the agent while it works on something else', async () => {
    mocks.connect.mockResolvedValue('connected');
    mocks.turns = [{ ...monday, state: 'running' }];
    await mount(true).connect(linear, mondayReply);
    expect(mocks.send).not.toHaveBeenCalled();
    expect(mocks.alert).toHaveBeenCalledWith(notResumed);
  });

  it('carries nothing on from a button outside a reply', async () => {
    mocks.connect.mockResolvedValue('connected');
    mocks.turns = [monday];
    await mount(true).connect(linear);
    expect(mocks.send).not.toHaveBeenCalled();
    expect(mocks.alert).toHaveBeenCalledWith(notResumed);
  });

  it('says nothing when the person closed the connection window', async () => {
    mocks.connect.mockResolvedValue('closed');
    mocks.turns = [monday];
    await mount(true).connect(linear, mondayReply);
    expect(mocks.send).not.toHaveBeenCalled();
    expect(mocks.alert).not.toHaveBeenCalled();
  });

  it('leaves other channels to the connection settings', () => {
    expect(mount(false).enabled?.()).toBe(false);
  });
});
