import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  openWithSplit: vi.fn(),
  getOrCreate: vi.fn(),
}));

// The notice code this module also holds is not under test here.
vi.mock('@app/features/settings/computers/primitives/setup-notice', () => ({
  showComputerSetupNotice: vi.fn(),
}));
vi.mock('@app/features/settings/computers/primitives/setup-request', () => ({
  requestComputerSetup: vi.fn(),
}));
vi.mock('@app/features/settings/primitives/team-agent-claude-request', () => ({
  requestAgentClaude: vi.fn(),
}));
vi.mock('@app/features/settings/primitives/team-agent-setup-notice', () => ({
  showTeamAgentSetupNotice: vi.fn(),
}));
vi.mock('@app/features/settings/primitives/team-agent-status', () => ({
  retryTeamAgentComputer: vi.fn(),
}));
vi.mock('@core/component/Toast/Toast', () => ({ toast: {} }));
vi.mock('@queries/harnesses/harnesses', () => ({ fetchHarnesses: vi.fn() }));
vi.mock('./notification-navigation', () => ({
  openBillingSettings: vi.fn(),
  openRuntimesSettings: vi.fn(),
  openTeamMembersSettings: vi.fn(),
}));
vi.mock('@app/signal/splitLayout', () => ({
  globalSplitManager: () => ({ openWithSplit: mocks.openWithSplit }),
}));
vi.mock('@queries/auth/cached-user-id', () => ({
  cachedUserId: () => 'macro|maya@example.com',
}));
vi.mock('@service-storage/client', () => ({
  storageServiceClient: { getOrCreateDirectMessage: mocks.getOrCreate },
}));
vi.mock('@queries/channel/channels', () => ({
  invalidateListChannels: () => Promise.resolve(),
  loadChannelList: () => Promise.resolve([]),
}));

import { ok } from 'neverthrow';
import { openAgentDirectMessage } from './computer-setup-toast';

beforeEach(() => {
  mocks.openWithSplit.mockReset();
  mocks.getOrCreate.mockReset();
});

describe('openAgentDirectMessage', () => {
  it('opens the real DM with a new agent, so its greeting lands in the open conversation', async () => {
    mocks.getOrCreate.mockResolvedValue(ok({ channel_id: 'channel-ada' }));

    openAgentDirectMessage('macro|ada@agents.macro.invalid');

    await vi.waitFor(() =>
      expect(mocks.openWithSplit).toHaveBeenCalledWith(
        { type: 'channel', id: 'channel-ada' },
        { activate: true, referredFrom: null }
      )
    );
    expect(mocks.getOrCreate).toHaveBeenCalledWith({
      recipient_id: 'macro|ada@agents.macro.invalid',
    });
  });
});
