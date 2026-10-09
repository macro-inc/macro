import { fireEvent, render, screen } from '@solidjs/testing-library';
import { beforeEach, expect, it, vi } from 'vitest';
import { CreateChannelsChip } from './CreateChannelsChip';

const host = vi.hoisted(() => ({ openNewChannelModal: vi.fn() }));

vi.mock('@channel/CreateChannelModal', () => ({
  openNewChannelModal: host.openNewChannelModal,
}));
vi.mock('@ui', () => ({
  Button: (props: { onClick: () => void; children: unknown }) => (
    <button type="button" onClick={props.onClick}>
      {props.children as string}
    </button>
  ),
}));

beforeEach(() => {
  localStorage.clear();
  host.openNewChannelModal.mockClear();
});

it('nudges a workspace with few channels to create one', () => {
  render(() => <CreateChannelsChip channelCount={1} />);

  fireEvent.click(screen.getByRole('button', { name: 'Create a channel' }));

  expect(host.openNewChannelModal).toHaveBeenCalledOnce();
});

it('goes away once the workspace has enough channels', () => {
  render(() => <CreateChannelsChip channelCount={3} />);

  expect(screen.queryByText('Make a home for your team')).toBeNull();
});

it('stays dismissed after the user closes it', () => {
  const first = render(() => <CreateChannelsChip channelCount={0} />);
  fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
  expect(screen.queryByText('Make a home for your team')).toBeNull();
  first.unmount();

  render(() => <CreateChannelsChip channelCount={0} />);
  expect(screen.queryByText('Make a home for your team')).toBeNull();
});
