// @vitest-environment jsdom
import { createRoot, createSignal } from 'solid-js';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useActiveCallTeamShare } from '../use-toggle-share-with-team';

const mocks = vi.hoisted(() => ({
  context: undefined as unknown,
  mutate: vi.fn(),
  setShared: vi.fn(),
}));

vi.mock('../CallContext', () => ({ useCallContext: () => mocks.context }));
vi.mock('@queries/call/call', () => ({
  useToggleShareWithTeamMutation: () => ({
    mutateAsync: mocks.mutate,
    isPending: false,
  }),
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

    setChannelId(null);
    await control.toggle();
    expect(mocks.mutate).toHaveBeenCalledOnce();
  });
});
