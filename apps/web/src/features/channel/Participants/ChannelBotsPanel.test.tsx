/** @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import { type JSX, Show } from 'solid-js';
import { afterEach, expect, it, vi } from 'vitest';
import { ChannelBotsPanel } from './ChannelBotsPanel';

const mocks = vi.hoisted(() => ({ remove: vi.fn() }));
vi.mock('@core/mobile/isTouchDevice', () => ({ isTouchDevice: () => true }));
vi.mock('@core/component/Toast/Toast', () => ({
  toast: { success: vi.fn(), failure: vi.fn() },
}));
vi.mock('@queries/channel/channel-bots', () => ({
  useChannelBotsQuery: () => ({
    isSuccess: true,
    isLoading: false,
    data: [
      {
        id: 'teo',
        name: 'Teobot',
        handle: 'teobot',
        description: 'Repeats messages',
        avatar_url: null,
      },
      {
        id: 'helper',
        name: 'Helper',
        handle: 'assistant',
        description: 'Summarizes threads',
        avatar_url: null,
      },
    ],
  }),
  useRemoveBotFromChannelMutation: () => ({
    mutate: mocks.remove,
    isPending: false,
  }),
}));
vi.mock('@ui', async () => ({
  ...(await import('@ui/components/Button')),
  ...(await import('@ui/components/InputGroup')),
  ...(await import('@ui/components/Avatar')),
  ...(await import('@ui/components/Badge')),
  ...(await import('@ui/components/Item')),
}));
vi.mock('./ParticipantsActionSheet', () => ({
  ParticipantsActionSheet: (props: {
    open: boolean;
    children: JSX.Element;
  }) => (
    <Show when={props.open}>
      <div role="dialog">{props.children}</div>
    </Show>
  ),
}));
vi.mock('../Bots/BotInviteSelect', () => ({
  BotInviteSelect: (props: { onInvited?: () => void }) => (
    <button onClick={props.onInvited}>Confirm invitation</button>
  ),
}));
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

it('filters existing bots and keeps row actions separate from opening a bot', () => {
  const open = vi.fn();
  render(() => (
    <ChannelBotsPanel
      channelId="channel"
      editable
      inviteFocusRequest={0}
      onCreateBot={vi.fn()}
      onOpenBot={open}
    />
  ));
  const search = screen.getByRole('searchbox', { name: 'Search bots' });
  fireEvent.input(search, { target: { value: 'ASSISTANT' } });
  expect(screen.queryByRole('link', { name: 'Open Teobot' })).toBeNull();
  fireEvent.click(screen.getByRole('link', { name: 'Open Helper' }));
  expect(open).toHaveBeenCalledWith('helper');
  fireEvent.click(screen.getByRole('button', { name: 'Remove Helper' }));
  expect(open).toHaveBeenCalledTimes(1);
  expect(mocks.remove).toHaveBeenCalledWith(
    { channelId: 'channel', botId: 'helper' },
    expect.any(Object)
  );
  fireEvent.input(search, { target: { value: 'missing' } });
  expect(screen.getByText('No matching bots')).toBeTruthy();
  fireEvent.input(search, { target: { value: '' } });
  expect(screen.getByRole('link', { name: 'Open Teobot' })).toBeTruthy();
});

it('uses compact create and invite actions and closes the invite sheet on success', () => {
  const create = vi.fn();
  render(() => (
    <ChannelBotsPanel
      channelId="channel"
      editable
      inviteFocusRequest={0}
      onCreateBot={create}
      onOpenBot={vi.fn()}
    />
  ));
  expect(screen.queryByRole('dialog')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'New bot' }));
  expect(create).toHaveBeenCalledOnce();
  fireEvent.click(screen.getByRole('button', { name: 'Invite bot' }));
  expect(screen.getByRole('dialog')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Confirm invitation' }));
  expect(screen.queryByRole('dialog')).toBeNull();
});
