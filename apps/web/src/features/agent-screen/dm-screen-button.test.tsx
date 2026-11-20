import { fireEvent, render, screen } from '@solidjs/testing-library';
import { Show } from 'solid-js';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DmScreenButton,
  DmScreenIsland,
  useDmScreenHarnessId,
} from './dm-screen-button';

const state = vi.hoisted(() => ({
  participants: [] as string[],
  openWithSplit: vi.fn(),
}));

vi.mock('@core/context/user', () => ({ useUserId: () => () => 'user-alice' }));
vi.mock('@channel/use-channel-participants', () => ({
  useChannelParticipants: () => ({
    ids: () => state.participants,
    users: () => [],
  }),
}));
vi.mock('@queries/harnesses/harnesses', () => ({
  useHarnessesQuery: () => ({
    isSuccess: true,
    data: [
      {
        id: 'harness-ada',
        team_agent_user_id: 'user-ada-agent',
        access: 'owner',
      },
    ],
  }),
}));
vi.mock('@core/context/channels', () => ({
  useChannelType: () => () => 'direct_message',
  useChannel: () => () => ({ id: 'dm-1' }),
}));
vi.mock('@components/app/split-layout/layout', () => ({
  useSplitLayout: () => ({ openWithSplit: state.openWithSplit }),
}));

/** A DM header's Screen slot, as ChannelDetail composes it. */
function DmHeader() {
  const harnessId = useDmScreenHarnessId('dm-1');
  return (
    <Show when={harnessId()}>
      {(id) => <DmScreenButton harnessId={id()} />}
    </Show>
  );
}

beforeEach(() => state.openWithSplit.mockClear());

describe('DM Screen button', () => {
  it('shows in an ordinary DM with a team agent teammate and opens its computer', () => {
    // A team agent is a user: its DM is a normal DM, not a bot DM.
    state.participants = ['user-alice', 'user-ada-agent'];
    render(() => <DmHeader />);

    fireEvent.click(screen.getByRole('button', { name: 'Screen' }));

    expect(state.openWithSplit).toHaveBeenCalledWith(
      {
        type: 'component',
        id: 'agent-screen',
        params: { harnessId: 'harness-ada' },
      },
      { preferNewSplit: true }
    );
  });

  it('stays out of a DM with a person', () => {
    state.participants = ['user-alice', 'user-bob'];
    render(() => <DmHeader />);
    expect(screen.queryByRole('button', { name: 'Screen' })).toBeNull();
  });

  it("shows its own header island in the touch header of a team agent teammate's DM", () => {
    document.documentElement.dataset.touchDevice = 'true';
    state.participants = ['user-alice', 'user-ada-agent'];
    render(() => <DmScreenIsland channelId="dm-1" />);

    fireEvent.click(screen.getByRole('button', { name: 'Screen' }));
    expect(state.openWithSplit).toHaveBeenCalledTimes(1);
    delete document.documentElement.dataset.touchDevice;
  });
});
