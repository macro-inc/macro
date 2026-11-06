// @vitest-environment jsdom
import { createRoot, createSignal } from 'solid-js';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useActiveCallTeamShare } from '../use-toggle-share-with-team';

const mocks = vi.hoisted(() => ({
  context: undefined as unknown,
  mutate: vi.fn(),
  setShared: vi.fn(),
  toastSuccess: vi.fn(),
}));

vi.mock('../CallContext', () => ({ useCallContext: () => mocks.context }));
vi.mock('@queries/call/call', () => ({
  useToggleShareWithTeamMutation: () => ({
    mutateAsync: mocks.mutate,
    isPending: false,
  }),
}));
vi.mock('../use-call-team-share-change', () => ({
  useCallTeamShareChange: () => ({ answer: vi.fn() }),
}));
vi.mock('@core/component/Toast/Toast', () => ({
  toast: { success: mocks.toastSuccess },
}));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.mutate.mockResolvedValue(true);
});

describe('active call team sharing', () => {
  it('refuses standalone calls and preserves channel call sharing', async () => {
    const [channelId, setChannelId] = createSignal<string | null>(null);
    mocks.context = {
      activeCallId: () => 'call-1',
      activeChannelId: channelId,
      isSharedWithTeam: () => false,
      setSharedWithTeam: mocks.setShared,
    };
    const control = createRoot(() => useActiveCallTeamShare());
    expect(control.canToggle()).toBe(false);
    await control.toggle();
    expect(mocks.mutate).not.toHaveBeenCalled();

    setChannelId('channel-1');
    expect(control.canToggle()).toBe(true);
    await control.toggle();
    expect(mocks.mutate).toHaveBeenCalledWith('call-1');
    expect(mocks.setShared).toHaveBeenCalledWith(true);
    expect(mocks.toastSuccess).not.toHaveBeenCalled();

    setChannelId(null);
    await control.toggle();
    expect(mocks.mutate).toHaveBeenCalledOnce();
  });

  it('tells the requester when the others have to approve first', async () => {
    mocks.context = {
      activeCallId: () => 'call-1',
      activeChannelId: () => 'channel-1',
      isSharedWithTeam: () => false,
      setSharedWithTeam: mocks.setShared,
    };
    mocks.mutate.mockResolvedValue(false);
    const control = createRoot(() => useActiveCallTeamShare());

    await control.toggle();

    expect(mocks.setShared).toHaveBeenCalledWith(false);
    expect(mocks.toastSuccess).toHaveBeenCalledOnce();
  });
});
